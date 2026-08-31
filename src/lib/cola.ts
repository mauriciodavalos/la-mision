// Cola offline en IndexedDB. Guarda las visitas pendientes CON sus blobs de foto,
// así sobreviven a recargas, cierre de la app y falta de señal.
//
// Regla de oro: una visita sale de la cola SOLO cuando el servidor confirma que
// se guardó (ver sync.ts -> eliminar()). Mientras tanto, nunca se pierde evidencia.

import type { Borrador, VisitaPendiente } from "./tipos";

const DB_NOMBRE = "lamision-cola";
// v2 agrega el store `catalogo` (ver catalogo-cache.ts) para que la app abra y
// valide el PIN sin señal.
// v3 agrega el store `borrador`: la captura a medio llenar, para que un cierre
// inesperado del navegador no se lleve las fotos ya tomadas (pasó en campo el 31
// de agosto, con un teléfono que se quedaba sin memoria al tomar la foto).
// Las dos migraciones son ADITIVAS: no tocan el store `visitas`, así que una cola
// con visitas pendientes sobrevive intacta a la actualización.
const DB_VERSION = 3;
const STORE = "visitas";
export const STORE_CATALOGO = "catalogo";
const STORE_BORRADOR = "borrador";
// Solo hay una captura en curso por dispositivo, así que el borrador vive en una
// llave fija en vez de acumular registros huérfanos.
const LLAVE_BORRADOR = "actual";

let dbPromise: Promise<IDBDatabase> | null = null;

// Abre (y migra) la base. La comparten la cola de visitas y el cache de catálogo.
export function abrir(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_CATALOGO)) {
        db.createObjectStore(STORE_CATALOGO, { keyPath: "clave" });
      }
      if (!db.objectStoreNames.contains(STORE_BORRADOR)) {
        db.createObjectStore(STORE_BORRADOR, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Subir de versión se queda BLOQUEADO si el agente tiene la app abierta en
    // otra pestaña con la versión anterior. Sin esto, `abrir()` no resolvería
    // nunca y la captura se colgaría en silencio, sin cola y sin explicación.
    req.onblocked = () =>
      reject(
        new Error(
          "La app está abierta en otra pestaña con una versión anterior. " +
            "Ciérrala y vuelve a cargar esta."
        )
      );
  });
  // Un fallo al abrir no debe dejar la promesa rota para siempre: al reintentar
  // (ya cerrada la otra pestaña) se vuelve a abrir de cero.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx(db: IDBDatabase, modo: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, modo).objectStore(STORE);
}

export async function guardar(v: VisitaPendiente): Promise<void> {
  const db = await abrir();
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, "readwrite").put(v);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function listar(): Promise<VisitaPendiente[]> {
  const db = await abrir();
  const todas = await new Promise<VisitaPendiente[]>((resolve, reject) => {
    const req = tx(db, "readonly").getAll();
    req.onsuccess = () => resolve(req.result as VisitaPendiente[]);
    req.onerror = () => reject(req.error);
  });
  // Más recientes primero (por hora real de captura).
  return todas.sort((a, b) => b.creada_en.localeCompare(a.creada_en));
}

export async function obtener(id: string): Promise<VisitaPendiente | undefined> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly").get(id);
    req.onsuccess = () => resolve(req.result as VisitaPendiente | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function eliminar(id: string): Promise<void> {
  const db = await abrir();
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---- borrador: la captura que todavía no se guarda ----
//
// OJO, va en su propio store y NO en `catalogo`: olvidarIdentidad() vacía el
// catálogo al cambiar de agente, y el borrador trae fotos — o sea, evidencia.
// Se guarda conforme se captura y se borra cuando la visita entra en la cola.

function txBorrador(db: IDBDatabase, modo: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_BORRADOR, modo).objectStore(STORE_BORRADOR);
}

export async function guardarBorrador(b: Omit<Borrador, "id">): Promise<void> {
  const db = await abrir();
  await new Promise<void>((resolve, reject) => {
    const req = txBorrador(db, "readwrite").put({ ...b, id: LLAVE_BORRADOR });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function leerBorrador(): Promise<Borrador | undefined> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const req = txBorrador(db, "readonly").get(LLAVE_BORRADOR);
    req.onsuccess = () => resolve(req.result as Borrador | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function borrarBorrador(): Promise<void> {
  const db = await abrir();
  await new Promise<void>((resolve, reject) => {
    const req = txBorrador(db, "readwrite").delete(LLAVE_BORRADOR);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
