// Que el navegador no se lleve la evidencia sin subir.
//
// EL HUECO QUE CIERRA
//
// La cola de visitas vive en IndexedDB, y eso está bien: sobrevive a cerrar la
// pestaña, a recargar y a quedarse sin señal. Pero por omisión el almacenamiento
// de un sitio es "best-effort": **si el teléfono se queda corto de espacio, el
// navegador puede desalojar los datos del origen completos**, incluyendo visitas
// que todavía no se han subido, con sus fotos.
//
// Ese es el único camino por el que hoy se puede perder evidencia de verdad, y
// contradice la regla no negociable del proyecto. Es plausible justo en los
// teléfonos que ya nos dieron problemas: los que andan cortos de memoria.
//
// `navigator.storage.persist()` marca el origen como persistente y lo saca de la
// lista de desalojo automático. El navegador decide si lo concede —Chrome lo da
// casi siempre a una PWA instalada o a un sitio con uso real— y no hay forma de
// forzarlo, pero pedirlo cuesta una llamada y sin pedirlo la respuesta es no.
//
// Costo: cero red, cero storage en el servidor.

export type EstadoAlmacen = "persistente" | "mejor-esfuerzo" | "desconocido";

/**
 * Pide almacenamiento persistente si todavía no lo tenemos.
 * Nunca lanza: un fallo aquí no puede estorbar la captura.
 */
export async function asegurarPersistencia(): Promise<EstadoAlmacen> {
  try {
    if (!navigator.storage?.persist) return "desconocido";
    // Si ya está concedido, no se vuelve a pedir: en algunos navegadores
    // `persist()` muestra un aviso al usuario.
    if (await navigator.storage.persisted?.()) return "persistente";
    return (await navigator.storage.persist()) ? "persistente" : "mejor-esfuerzo";
  } catch {
    return "desconocido";
  }
}

export interface Espacio {
  usadoMB: number;
  cuotaMB: number;
  libreMB: number;
  /** Queda tan poco que conviene avisar ANTES de que fallen las escrituras. */
  apretado: boolean;
}

// Con ~380 KB por visita, 40 MB son más de cien visitas de margen. Por debajo de
// eso vale la pena avisar: cuando el navegador empieza a rechazar escrituras ya
// es tarde, porque lo que falla es guardar la foto recién tomada.
const MARGEN_MB = 40;

export async function espacio(): Promise<Espacio | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    if (typeof e.usage !== "number" || typeof e.quota !== "number" || !e.quota) return null;
    const mb = (b: number) => Math.round(b / 1048576);
    const libreMB = mb(e.quota - e.usage);
    return {
      usadoMB: mb(e.usage),
      cuotaMB: mb(e.quota),
      libreMB,
      apretado: libreMB < MARGEN_MB || e.usage / e.quota > 0.9,
    };
  } catch {
    return null;
  }
}
