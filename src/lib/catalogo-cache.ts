// Cache local del catálogo (clientes, marcas, cadenas, tiendas, agentes) en el
// mismo IndexedDB que la cola de visitas (store `catalogo`, ver cola.ts).
//
// Para qué:
//  * El agente puede abrir la app dentro de una tienda SIN SEÑAL y aun así tener
//    su marca, su lista de tiendas y poder validar su PIN.
//  * Baja el egress: el catálogo se descarga cuando hay red y se reusa, en vez de
//    consultarse en cada carga (y la búsqueda de tiendas deja de pegarle a la red
//    en cada tecla).
//
// No guarda nada sensible más allá del salt/hash del PIN, que ya es público en
// fase 1 (ver 0004_pin_agente.sql).

import { abrir, STORE_CATALOGO } from "./cola";

export interface EntradaCache<T> {
  clave: string;
  valor: T;
  guardado_en: string; // ISO UTC — para saber qué tan viejo está el catálogo
}

// Claves estables. Todo lo que dependa del cliente lleva su id en la clave, así
// nunca se mezclan datos de dos clientes en el mismo dispositivo.
export const claves = {
  clientes: () => "clientes",
  marcas: (clienteId: string) => `marcas:${clienteId}`,
  cadenas: (clienteId: string) => `cadenas:${clienteId}`,
  tiendas: (clienteId: string) => `tiendas:${clienteId}`,
  agentes: (clienteId: string) => `agentes:${clienteId}`,
};

export async function guardar<T>(clave: string, valor: T): Promise<void> {
  const db = await abrir();
  const entrada: EntradaCache<T> = {
    clave,
    valor,
    guardado_en: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const req = db
      .transaction(STORE_CATALOGO, "readwrite")
      .objectStore(STORE_CATALOGO)
      .put(entrada);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function leer<T>(clave: string): Promise<EntradaCache<T> | undefined> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE_CATALOGO, "readonly")
      .objectStore(STORE_CATALOGO)
      .get(clave);
    req.onsuccess = () => resolve(req.result as EntradaCache<T> | undefined);
    req.onerror = () => reject(req.error);
  });
}

// Solo el valor, o undefined si no hay nada cacheado.
export async function leerValor<T>(clave: string): Promise<T | undefined> {
  const e = await leer<T>(clave);
  return e?.valor;
}

// Estrategia estándar del catálogo: intentar la red, y si falla (o no hay señal)
// caer al cache. Cuando la red responde, se refresca el cache.
// Si no hay red NI cache, propaga el error original — nunca devuelve datos falsos.
export async function redPrimero<T>(
  clave: string,
  desdeRed: () => Promise<T>
): Promise<T> {
  if (navigator.onLine) {
    try {
      const valor = await desdeRed();
      await guardar(clave, valor);
      return valor;
    } catch (e) {
      const cacheado = await leerValor<T>(clave);
      if (cacheado !== undefined) return cacheado;
      throw e;
    }
  }
  const cacheado = await leerValor<T>(clave);
  if (cacheado !== undefined) return cacheado;
  // Sin señal y sin cache: que el llamador decida qué mostrar.
  throw new Error(
    "Sin señal y sin catálogo descargado. Conéctate una vez para descargarlo."
  );
}

// Borra el catálogo cacheado (al cambiar de agente/cliente en el dispositivo).
export async function limpiar(): Promise<void> {
  const db = await abrir();
  await new Promise<void>((resolve, reject) => {
    const req = db
      .transaction(STORE_CATALOGO, "readwrite")
      .objectStore(STORE_CATALOGO)
      .clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
