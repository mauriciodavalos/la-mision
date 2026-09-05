// Corregir la TIENDA de una visita ya sincronizada, desde el panel.
//
// POR QUÉ EXISTE
//
// El 4 sep 2026 Carmen capturó una visita en «1075 CENTRO INSURGENTES» cuando
// era «1006 INSURGENTES» — dos sucursales de Sanborns cuyos puntos observados
// quedan a 8 metros y cuyos nombres se parecen. Lo reportó ella misma. Con 264
// tiendas en catálogo va a volver a pasar, y hasta hoy la única forma de
// arreglarlo era entrar a la base a mano. Eso no es un proceso: es una llamada
// de auxilio cada vez.
//
// TRES REGLAS QUE EXPLICAN EL DISEÑO
//
// 1) NUNCA SE REESCRIBE EN SILENCIO. Esto es un producto de auditoría: un dato
//    corregido tiene que poder explicarse meses después. Cada corrección deja
//    su renglón en `visitas.datos._correcciones` — qué campo, de qué a qué,
//    quién y cuándo. Sin migración: `datos` ya es jsonb.
//
// 2) LA CADENA VIAJA CON LA TIENDA. `visitas` guarda `cadena_id` aparte de
//    `tienda_id`, y NINGUNA llave foránea obliga a que coincidan (0001_init.sql
//    ata cada una al cliente, no entre sí). Mover la tienda sin mover la cadena
//    dejaría la visita diciendo que fue en una cadena donde esa sucursal no
//    existe. Por eso `cadena_id` se toma SIEMPRE de la tienda destino.
//
// 3) LAS FOTOS NO SE MUEVEN. `storage_path` lleva el nombre de la tienda
//    original, y es tentador renombrar la carpeta para que el bucket se lea
//    parejo. No se hace: mover evidencia en producción por un tema cosmético
//    contradice "nunca perder evidencia", y el panel resuelve las fotos por
//    `storage_path`, así que no se rompe nada. El renglón de `_correcciones`
//    explica por qué la carpeta dice una cosa y la fila otra.
//
// COSTO: cero llamadas nuevas. Es un UPDATE de una fila sobre datos que el
// panel ya tenía en pantalla, y el catálogo de tiendas ya viene cacheado de la
// búsqueda de captura.

import { supabase } from "../db/supabase";
import type { Tienda } from "./tipos";

/** Lo mínimo que hay que saber de una visita para poder corregirla. */
export interface VisitaCorregible {
  id: string;
  cliente_id: string;
  tienda_id: string;
  cadena_id: string;
  tienda_clave: string;
  tienda_nombre: string | null;
  datos: Record<string, unknown>;
}

/** Un renglón del historial de correcciones que vive en `visitas.datos`. */
export interface Correccion {
  campo: string;
  de: string;
  a: string;
  /** Claves de sucursal, para leer el rastro sin cruzar UUIDs. */
  de_clave?: string;
  a_clave?: string;
  motivo?: string;
  por: string;
  en: string;
}

/** Los campos que hay que escribir, ya calculados y validados. */
export interface CambiosCorreccion {
  tienda_id: string;
  cadena_id: string;
  datos: Record<string, unknown>;
}

export type Preparado =
  | { ok: true; cambios: CambiosCorreccion; correccion: Correccion }
  | { ok: false; motivo: string };

// Las claves de campos configurables vienen de `config_captura` de la marca y
// son nombres de negocio ("piezas_exhibidas", "hay_precio"). El guion bajo
// reserva el espacio de la app, así que no chocan.
export const LLAVE_CORRECCIONES = "_correcciones";

export function historialDeCorrecciones(
  datos: Record<string, unknown> | null | undefined
): Correccion[] {
  const v = datos?.[LLAVE_CORRECCIONES];
  return Array.isArray(v) ? (v as Correccion[]) : [];
}

/**
 * Valida el cambio y arma lo que se va a escribir. Puro a propósito: es donde
 * viven las reglas que no se pueden probar a mano contra producción.
 */
export function prepararCorreccionTienda(
  visita: VisitaCorregible,
  destino: Tienda,
  porNombre: string,
  motivo?: string,
  ahora: Date = new Date()
): Preparado {
  if (destino.id === visita.tienda_id) {
    return { ok: false, motivo: "Es la misma tienda que ya tiene la visita." };
  }
  // El aislamiento multi-cliente se verifica en código, no se da por supuesto
  // porque la búsqueda ya filtre: en fase 1 no hay RLS que lo detenga después.
  if (destino.cliente_id !== visita.cliente_id) {
    return {
      ok: false,
      motivo: "Esa tienda es de otra empresa. Una visita no se mueve entre clientes.",
    };
  }

  const correccion: Correccion = {
    campo: "tienda_id",
    de: visita.tienda_id,
    a: destino.id,
    de_clave: visita.tienda_clave,
    a_clave: destino.clave_sucursal,
    por: porNombre,
    en: ahora.toISOString(),
  };
  const limpio = motivo?.trim();
  if (limpio) correccion.motivo = limpio;

  return {
    ok: true,
    correccion,
    cambios: {
      tienda_id: destino.id,
      // Regla 2: la cadena se toma de la tienda destino, nunca se deja la vieja.
      cadena_id: destino.cadena_id,
      datos: {
        ...visita.datos,
        [LLAVE_CORRECCIONES]: [...historialDeCorrecciones(visita.datos), correccion],
      },
    },
  };
}

export type ResultadoCorreccion =
  | { ok: true; correccion: Correccion }
  | { ok: false; motivo: string };

/**
 * Escribe la corrección. El UPDATE lleva `tienda_id` esperado en el WHERE: si
 * alguien más movió la visita entre que se pintó el panel y que se confirmó, no
 * se escribe nada y se avisa, en vez de pisar el cambio ajeno.
 */
export async function corregirTienda(
  visita: VisitaCorregible,
  destino: Tienda,
  porNombre: string,
  motivo?: string
): Promise<ResultadoCorreccion> {
  const p = prepararCorreccionTienda(visita, destino, porNombre, motivo);
  if (!p.ok) return p;

  const { data, error } = await supabase
    .from("visitas")
    .update(p.cambios)
    .eq("id", visita.id)
    .eq("tienda_id", visita.tienda_id) // candado optimista
    .select("id");

  if (error) return { ok: false, motivo: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      motivo:
        "La visita cambió mientras estaba abierta esta pantalla. Vuelve a consultar y revísala.",
    };
  }
  return { ok: true, correccion: p.correccion };
}
