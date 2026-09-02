// Migas de pan que SOBREVIVEN a que el navegador mate la pestaña.
//
// POR QUÉ EXISTE ESTO
//
// El 31 de agosto un teléfono en campo mostraba "Memoria insuficiente para
// completar la operación anterior" al tomar la foto. Se corrigió la compresión
// (comprimir.ts) y el problema siguió igual. El motivo de que no se pueda
// depurar a ciegas es que cuando el navegador mata la pestaña se lleva la
// consola, los logs y cualquier estado en memoria: no queda rastro de hasta
// dónde llegó el código.
//
// Aquí se escribe cada paso del flujo de foto en localStorage, que es
// SÍNCRONO: cuando `marcar()` regresa, el dato ya está en disco. IndexedDB no
// sirve para esto — sus escrituras son asíncronas y una pestaña que muere en el
// siguiente instante se las lleva sin guardar.
//
// Con eso, al reabrir la app se puede ver el último paso alcanzado y saber qué
// hipótesis es la buena:
//
//   * el rastro termina en `camara-abierta`  → la pestaña murió MIENTRAS la app
//     de cámara estaba al frente. Android mató el proceso del navegador por
//     memoria; nuestro código de compresión ni siquiera llegó a correr, y
//     comprimir mejor no arregla nada. La salida es no salir de la app.
//   * el rastro termina en `decodificando` o `codificando` → sí es la
//     compresión, y el detalle dice si se usó el camino escalado o el respaldo.
//   * no hay rastro roto → la pestaña no murió; es otra cosa.
//
// Costo: unos pocos KB en localStorage del teléfono. Cero red.

// Versión de la app, visible en pantalla. Sirve para lo más básico y lo más
// difícil de saber a distancia: si el teléfono de un agente está corriendo el
// código nuevo o uno cacheado por el service worker. Se sube junto con VERSION
// en public/sw.js.
export const VERSION_APP = "v3";

const LLAVE = "lamision.rastro";
const LLAVE_CAIDAS = "lamision.caidas";
const MAX_PASOS = 40;
const MAX_CAIDAS = 5;

export interface Paso {
  t: number;       // epoch ms
  p: string;       // nombre del paso
  d?: string;      // detalle
}

export interface Caida {
  pasos: Paso[];
  equipo: string;  // de qué teléfono/navegador se trata
  en: number;      // cuándo se detectó
}

// ---- helpers de almacenamiento ----
// Todo va en try/catch: en modo privado de iOS, localStorage lanza al escribir.
// Un fallo aquí NUNCA puede estorbar la captura.

function leer<T>(llave: string, porOmision: T): T {
  try {
    const s = localStorage.getItem(llave);
    return s ? (JSON.parse(s) as T) : porOmision;
  } catch {
    return porOmision;
  }
}

function escribir(llave: string, valor: unknown): void {
  try {
    localStorage.setItem(llave, JSON.stringify(valor));
  } catch {
    /* sin espacio o sin permiso: se sigue sin rastro */
  }
}

// ---- descripción del equipo ----
// Sin esto, un reporte de caída no dice de qué teléfono vino. No se manda a
// ningún lado: se muestra en la pantalla para que el agente lo lea o lo copie.

export function describirEquipo(): string {
  const n = navigator as Navigator & { deviceMemory?: number };
  const partes = [`app ${VERSION_APP}`, navigator.userAgent];
  if (typeof n.deviceMemory === "number") partes.push(`RAM ~${n.deviceMemory} GB`);
  partes.push(`pantalla ${screen.width}×${screen.height}`);
  return partes.join(" · ");
}

// ---- API de rastro ----

/** Apunta un paso. Síncrono a propósito: el dato queda en disco al volver. */
export function marcar(paso: string, detalle?: string): void {
  const pasos = leer<Paso[]>(LLAVE, []);
  pasos.push({ t: Date.now(), p: paso, ...(detalle ? { d: detalle } : {}) });
  escribir(LLAVE, pasos.slice(-MAX_PASOS));
}

/** El flujo terminó bien: se borra el rastro para que no se lea como caída. */
export function cerrar(): void {
  try {
    localStorage.removeItem(LLAVE);
  } catch {
    /* nada */
  }
}

/**
 * Al arrancar la app: si quedó un rastro abierto, es que la pestaña murió a
 * media captura. Se archiva como caída y se limpia, para que la siguiente
 * captura empiece en blanco.
 */
export function revisarCaida(): Caida | null {
  const pasos = leer<Paso[]>(LLAVE, []);
  cerrar();
  if (pasos.length === 0) return null;

  const caida: Caida = { pasos, equipo: describirEquipo(), en: Date.now() };
  const caidas = leer<Caida[]>(LLAVE_CAIDAS, []);
  caidas.push(caida);
  escribir(LLAVE_CAIDAS, caidas.slice(-MAX_CAIDAS));
  return caida;
}

/** Las últimas caídas archivadas, para la pantalla de diagnóstico. */
export function listarCaidas(): Caida[] {
  return leer<Caida[]>(LLAVE_CAIDAS, []);
}

export function olvidarCaidas(): void {
  try {
    localStorage.removeItem(LLAVE_CAIDAS);
  } catch {
    /* nada */
  }
}

/**
 * ¿La caída ocurrió con la app de cámara al frente?
 *
 * Es LA pregunta que decide el arreglo: si el último paso alcanzado fue abrir
 * la cámara del sistema y nunca llegó el archivo, el navegador murió estando en
 * segundo plano. Comprimir mejor no sirve; hay que dejar de salir de la app.
 */
export function murioEnLaCamara(c: Caida): boolean {
  const ultimo = c.pasos[c.pasos.length - 1];
  return !!ultimo && ultimo.p === "camara-abierta";
}

/** Rastro en texto plano, para leerlo en pantalla o copiarlo a un mensaje. */
export function comoTexto(c: Caida): string {
  const inicio = c.pasos[0]?.t ?? c.en;
  const lineas = c.pasos.map((p) => {
    const seg = ((p.t - inicio) / 1000).toFixed(1).padStart(5, " ");
    return `+${seg}s  ${p.p}${p.d ? "  — " + p.d : ""}`;
  });
  return [
    `Caída detectada: ${new Date(c.en).toLocaleString("es-MX")}`,
    c.equipo,
    "",
    ...lineas,
    "",
    murioEnLaCamara(c)
      ? "Murió con la cámara del sistema abierta (el navegador estaba en segundo plano)."
      : "Murió procesando la foto dentro de la app.",
  ].join("\n");
}
