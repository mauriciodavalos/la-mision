// Importación de tiendas desde CSV (herramienta de administración, FASE 1).
//
// El catálogo de tiendas es lo que crece con el tiempo, así que tiene que poder
// cargarse sin escribir SQL. El archivo se lee en el navegador (FileReader) y
// NUNCA se sube a ningún lado: solo viajan las filas ya validadas.
//
// Parseo propio: un CSV de catálogo no justifica meter una dependencia al bundle
// de la PWA. Soporta comillas dobles, comas dentro de comillas, CRLF y BOM.

import { supabase } from "../db/supabase";

export interface FilaTienda {
  clave_sucursal: string;
  nombre: string | null;
  direccion: string | null;
  municipio: string | null;
  estado: string | null;
  latitud: number | null;
  longitud: number | null;
}

export interface FilaRevisada {
  linea: number;          // número de renglón en el archivo (para señalar el error)
  fila: FilaTienda | null;
  error: string | null;
}

export interface Revision {
  encabezados: string[];
  validas: FilaRevisada[];
  invalidas: FilaRevisada[];
  duplicadas: string[];   // claves repetidas DENTRO del archivo
}

// ---- parseo ----------------------------------------------------------------

// Divide el CSV respetando comillas dobles ("" escapa una comilla dentro).
function parseCSV(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;

  // Quita el BOM que meten Excel y Google Sheets al exportar.
  const t = texto.replace(/^﻿/, "");

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') {
      enComillas = true;
    } else if (c === "," || c === ";") {
      // Excel en español exporta con punto y coma.
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c === "\r") {
      // parte de un CRLF: se ignora
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c.trim() !== ""));
}

// Normaliza encabezados: sin acentos ni puntuación, minúsculas, espacios -> guion
// bajo. Lo de la puntuación importa: los archivos de retail traen encabezados como
// "No. Tienda" o "Clave (sucursal)", y sin quitarla no empatan con ningún alias.
function normEncabezado(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, "") // fuera puntos, paréntesis, #, etc.
    .trim()
    .replace(/\s+/g, "_");
}

// Sinónimos aceptados por columna: cada retailer nombra distinto sus campos y no
// se le va a pedir a nadie que renombre el archivo a mano.
const ALIAS: Record<keyof FilaTienda, string[]> = {
  clave_sucursal: ["clave_sucursal", "clave", "no_tienda", "numero_tienda", "num_tienda", "id_tienda", "sucursal_clave", "cr"],
  nombre: ["nombre", "sucursal", "nombre_sucursal", "nombre_tienda", "tienda", "nombre_interno", "descripcion"],
  direccion: ["direccion", "domicilio", "calle"],
  municipio: ["municipio", "ciudad", "delegacion", "alcaldia", "localidad"],
  estado: ["estado", "entidad", "entidad_federativa"],
  latitud: ["latitud", "lat"],
  longitud: ["longitud", "lng", "lon", "long"],
};

function mapaColumnas(encabezados: string[]): Partial<Record<keyof FilaTienda, number>> {
  const norm = encabezados.map(normEncabezado);
  const mapa: Partial<Record<keyof FilaTienda, number>> = {};
  for (const campo of Object.keys(ALIAS) as (keyof FilaTienda)[]) {
    const i = norm.findIndex((h) => ALIAS[campo].includes(h));
    if (i >= 0) mapa[campo] = i;
  }
  return mapa;
}

function aNumero(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function aTexto(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

// ---- revisión (antes de escribir nada) -------------------------------------

export function revisarCSV(texto: string): Revision {
  const filas = parseCSV(texto);
  if (filas.length === 0) {
    return { encabezados: [], validas: [], invalidas: [], duplicadas: [] };
  }

  const encabezados = filas[0];
  const mapa = mapaColumnas(encabezados);
  const validas: FilaRevisada[] = [];
  const invalidas: FilaRevisada[] = [];
  const vistas = new Set<string>();
  const duplicadas = new Set<string>();

  if (mapa.clave_sucursal === undefined) {
    invalidas.push({
      linea: 1,
      fila: null,
      error:
        "No se encontró la columna de clave de sucursal. Debe llamarse clave_sucursal, clave, no_tienda o id_tienda.",
    });
    return { encabezados, validas, invalidas, duplicadas: [] };
  }

  for (let i = 1; i < filas.length; i++) {
    const celdas = filas[i];
    const linea = i + 1; // 1-indexado y contando el encabezado
    const clave = aTexto(celdas[mapa.clave_sucursal!]);

    if (!clave) {
      invalidas.push({ linea, fila: null, error: "Sin clave de sucursal." });
      continue;
    }
    if (vistas.has(clave)) {
      duplicadas.add(clave);
      invalidas.push({ linea, fila: null, error: `Clave repetida en el archivo: ${clave}` });
      continue;
    }
    vistas.add(clave);

    const lat = mapa.latitud !== undefined ? aNumero(celdas[mapa.latitud]) : null;
    const lng = mapa.longitud !== undefined ? aNumero(celdas[mapa.longitud]) : null;

    // Coordenadas fuera de rango: se avisa y se guardan en nulo, pero la tienda
    // NO se descarta — el GPS real lo pone el agente al capturar la visita.
    const latOk = lat === null || (lat >= -90 && lat <= 90);
    const lngOk = lng === null || (lng >= -180 && lng <= 180);

    const fila: FilaTienda = {
      clave_sucursal: clave,
      nombre: mapa.nombre !== undefined ? aTexto(celdas[mapa.nombre]) : null,
      direccion: mapa.direccion !== undefined ? aTexto(celdas[mapa.direccion]) : null,
      municipio: mapa.municipio !== undefined ? aTexto(celdas[mapa.municipio]) : null,
      estado: mapa.estado !== undefined ? aTexto(celdas[mapa.estado]) : null,
      latitud: latOk ? lat : null,
      longitud: lngOk ? lng : null,
    };

    validas.push({
      linea,
      fila,
      error: latOk && lngOk ? null : "Coordenadas fuera de rango: se guardan sin GPS.",
    });
  }

  return { encabezados, validas, invalidas, duplicadas: [...duplicadas] };
}

// ---- escritura --------------------------------------------------------------

export interface ResultadoImportacion {
  escritas: number;
  errores: string[];
}

const LOTE = 200;

// Escribe las tiendas con upsert sobre (cadena_id, clave_sucursal) — el índice
// único ya existe en 0001_init.sql. Reimportar el mismo archivo ACTUALIZA, no
// duplica: es seguro correrlo cada vez que crezca la ruta.
export async function importarTiendas(
  clienteId: string,
  cadenaId: string,
  filas: FilaTienda[]
): Promise<ResultadoImportacion> {
  const errores: string[] = [];
  let escritas = 0;

  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE).map((f) => ({
      cliente_id: clienteId,
      cadena_id: cadenaId,
      clave_sucursal: f.clave_sucursal,
      nombre: f.nombre,
      direccion: f.direccion,
      municipio: f.municipio,
      estado: f.estado,
      latitud: f.latitud,
      longitud: f.longitud,
      activo: true,
    }));

    const { error, count } = await supabase
      .from("tiendas")
      .upsert(lote, { onConflict: "cadena_id,clave_sucursal", count: "exact" });

    if (error) {
      errores.push(`Filas ${i + 1}–${i + lote.length}: ${error.message}`);
    } else {
      escritas += count ?? lote.length;
    }
  }

  return { escritas, errores };
}
