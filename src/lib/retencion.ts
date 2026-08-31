// Retención de la cola local (IndexedDB).
//
// El problema que resuelve: hasta ahora una visita nunca salía de la cola. Se
// marcaba "sincronizado" y se quedaba con sus fotos completas en el teléfono,
// para siempre. A ~380 KB por visita y 20 visitas al día son unos 230 MB al mes,
// creciendo sin tope, hasta que el navegador empieza a rechazar escrituras por
// cuota — y ahí se rompe la captura, que es lo único que no puede fallar.
//
// La política, en orden de prudencia:
//   1. Una visita NO confirmada por el servidor no se toca jamás. Ni sus fotos ni
//      su registro. Es la regla de "nunca perder evidencia" y no tiene excepción.
//   2. Confirmada + 48 h  -> se sueltan los blobs de las fotos (ya están en
//      Supabase). El registro sigue visible con tienda, hora y GPS; solo pierde
//      la miniatura. Ahí está prácticamente todo el espacio.
//   3. Confirmada + 30 días -> se borra el registro local. El historial largo se
//      consulta al servidor por rango de fechas (ver historial.ts).

import * as cola from "./cola";
import type { VisitaPendiente } from "./tipos";

export const HORAS_CONSERVAR_FOTOS = 48;
export const DIAS_CONSERVAR_REGISTRO = 30;

const MS_HORA = 3_600_000;
const MS_DIA = 86_400_000;

export interface ResultadoPurga {
  fotosLiberadas: number;   // cuántas fotos soltaron su blob
  bytesLiberados: number;
  registrosBorrados: number;
}

// ¿Está confirmada por el servidor y ya pasó el plazo?
function antiguedadMs(v: VisitaPendiente): number | null {
  if (v.estado !== "sincronizado") return null; // pendiente o error: intocable
  const ref = v.subida_en ?? v.creada_en;
  const t = Date.parse(ref);
  if (Number.isNaN(t)) return null;
  return Date.now() - t;
}

// La limpieza es AUTOMÁTICA: no hay botón para forzarla. Se decidió así para no
// darle al agente una palanca sobre la evidencia — su trabajo es capturar, no
// administrar el almacenamiento del teléfono.
export async function purgar(): Promise<ResultadoPurga> {
  return recorrer(await cola.listar(), true);
}

async function recorrer(visitas: VisitaPendiente[], aplicar: boolean): Promise<ResultadoPurga> {
  const r: ResultadoPurga = { fotosLiberadas: 0, bytesLiberados: 0, registrosBorrados: 0 };

  for (const v of visitas) {
    const edad = antiguedadMs(v);
    if (edad === null) continue; // no confirmada: se queda intacta

    if (edad > DIAS_CONSERVAR_REGISTRO * MS_DIA) {
      r.registrosBorrados++;
      r.bytesLiberados += v.fotos.reduce((s, f) => s + (f.blob ? f.bytes : 0), 0);
      if (aplicar) await cola.eliminar(v.id);
      continue;
    }

    if (edad > HORAS_CONSERVAR_FOTOS * MS_HORA) {
      const conBlob = v.fotos.filter((f) => f.blob);
      if (conBlob.length === 0) continue;
      r.fotosLiberadas += conBlob.length;
      r.bytesLiberados += conBlob.reduce((s, f) => s + f.bytes, 0);
      if (aplicar) {
        await cola.guardar({
          ...v,
          // Se conservan tipo, medidas y bytes para poder seguir mostrando el
          // registro; lo único que se suelta es la imagen.
          fotos: v.fotos.map((f) => ({ ...f, blob: undefined, liberada: true })),
        });
      }
    }
  }

  return r;
}

// Se llama al arrancar y después de cada sincronización. Nunca lanza: si la
// limpieza falla, la app tiene que seguir capturando igual.
export async function purgarSilencioso(): Promise<void> {
  try {
    const r = await purgar();
    if (r.fotosLiberadas || r.registrosBorrados) {
      window.dispatchEvent(new CustomEvent("cola-cambio"));
    }
  } catch {
    /* la limpieza nunca debe estorbar a la captura */
  }
}
