// Qué avisarle al agente cuando la cola cambia, y de qué forma.
//
// POR QUÉ ESTÁ APARTE
//
// La regla parece obvia hasta que se escribe: un popup solo se justifica para el
// registro que el agente ACABA de guardar y está esperando. Las confirmaciones
// que llegan después —el teléfono recupera señal y sube tres visitas de golpe
// mientras el agente está tomando fotos de la cuarta— no pueden abrir un popup:
// interrumpirían la captura, que es justo lo que no debe fallar.
//
// Vive fuera de captura-ui.ts porque ahí no se puede probar sin arrastrar el DOM
// entero y el cliente de Supabase. Aquí es una función pura y se prueba sola.

import type { DetalleCola } from "./sync";

/** Lo que la UI está esperando confirmar, si es que espera algo. */
export interface Espera {
  id: string;
  desde: number; // Date.now() de cuando se guardó
}

export type Aviso =
  /** Subió la visita que el agente está esperando: popup. */
  | { tipo: "propia-subida" }
  /** Falló la visita que espera: popup, sin insinuar que se perdió. */
  | { tipo: "propia-fallo"; error: string }
  /** Subió otra cosa (o varias): aviso discreto que se va solo. */
  | { tipo: "otras-subidas"; cuantas: number }
  | { tipo: "nada" };

/**
 * Cuánto se espera con el popup abierto antes de decirle al agente que quedó en
 * cola. Ocho segundos alcanzan para una subida con señal decente (dos fotos de
 * ~200 KB) y no dejan a nadie mirando una rueda girar dentro de una tienda.
 */
export const LIMITE_ESPERA_MS = 8000;

export function decidirAviso(espera: Espera | null, d: DetalleCola): Aviso {
  if (espera) {
    if (d.subidas.includes(espera.id)) return { tipo: "propia-subida" };
    const mío = d.errores.find((e) => e.id === espera.id);
    if (mío) return { tipo: "propia-fallo", error: mío.error };
  }
  // Las de los demás (o las propias ya resueltas) no interrumpen.
  const otras = d.subidas.filter((id) => id !== espera?.id).length;
  return otras > 0 ? { tipo: "otras-subidas", cuantas: otras } : { tipo: "nada" };
}

/** Texto del aviso discreto. Se arma aquí para poder probar el plural. */
export function textoOtrasSubidas(cuantas: number): string {
  return cuantas === 1 ? "1 registro subido al servidor" : `${cuantas} registros subidos al servidor`;
}

/** Aviso al cerrar la app con evidencia sin subir. */
export function textoPendientesAlSalir(pendientes: number): string | null {
  if (pendientes <= 0) return null;
  return pendientes === 1
    ? "Queda 1 registro sin subir. Si cierras la app deja de intentarlo hasta que la vuelvas a abrir."
    : `Quedan ${pendientes} registros sin subir. Si cierras la app deja de intentarlo hasta que la vuelvas a abrir.`;
}
