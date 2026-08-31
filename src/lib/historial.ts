// Historial de visitas consultado AL SERVIDOR por rango de fechas.
//
// Para qué: la cola local solo conserva lo reciente (ver retencion.ts). Cuando el
// agente quiere ver lo que hizo la semana pasada, se le pregunta a Supabase, en
// vez de cargar el teléfono con meses de fotos.
//
// COSTO (regla de CLAUDE.md: toda propuesta dice cuánto cuesta):
//  * La lista es solo texto: unos pocos KB por consulta, sin importar el rango.
//  * Las FOTOS no se cargan solas. Se piden por visita, cuando el agente toca
//    "ver fotos". Cada foto son ~200 KB de egress, así que abrir 10 visitas son
//    ~4 MB. Si se cargaran las miniaturas de toda la lista, una semana de trabajo
//    serían decenas de MB por cada vez que alguien abre la pestaña.
//  * Las URLs son firmadas y temporales: el bucket es privado.

import { supabase } from "../db/supabase";

export interface VisitaHistorial {
  id: string;
  capturada_en: string;
  tienda_clave: string;
  tienda_nombre: string | null;
  cadena_nombre: string | null;
  marca_nombre: string | null;
  agente_nombre: string | null;
  latitud: number | null;
  longitud: number | null;
  notas: string | null;
  fotos: number;
}

export interface FotoHistorial {
  id: string;
  tipo: string;
  url: string;
  bytes: number | null;
}

const MAX_FILAS = 300;
const BUCKET = "evidencias";
// Una hora: alcanza de sobra para mirarlas y no deja ligas vivas por ahí.
const VIGENCIA_URL = 3600;

// Rango [desde, hasta] en fechas locales (YYYY-MM-DD), interpretadas en horario
// de operación. `hasta` es inclusivo: se consulta hasta el final de ese día.
export async function listarVisitas(
  clienteId: string,
  desde: string,
  hasta: string,
  agenteId?: string
): Promise<VisitaHistorial[]> {
  // America/Mexico_City es UTC-6 todo el año (México ya no cambia de horario).
  // Se arma el rango en UTC para que un día local no se corte a las 18:00.
  const desdeUtc = `${desde}T06:00:00.000Z`;
  const hastaUtc = `${sumarDia(hasta)}T05:59:59.999Z`;

  let q = supabase
    .from("visitas")
    .select(
      "id, capturada_en, latitud, longitud, notas, " +
        "tiendas(clave_sucursal, nombre), cadenas(nombre), marcas(nombre), " +
        "agentes(nombre), evidencias(id)"
    )
    .eq("cliente_id", clienteId)
    .gte("capturada_en", desdeUtc)
    .lte("capturada_en", hastaUtc)
    .order("capturada_en", { ascending: false })
    .limit(MAX_FILAS);

  if (agenteId) q = q.eq("agente_id", agenteId);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    capturada_en: r.capturada_en,
    tienda_clave: r.tiendas?.clave_sucursal ?? "?",
    tienda_nombre: r.tiendas?.nombre ?? null,
    cadena_nombre: r.cadenas?.nombre ?? null,
    marca_nombre: r.marcas?.nombre ?? null,
    agente_nombre: r.agentes?.nombre ?? null,
    latitud: r.latitud,
    longitud: r.longitud,
    notas: r.notas,
    fotos: Array.isArray(r.evidencias) ? r.evidencias.length : 0,
  }));
}

// Fotos de UNA visita, con URL firmada. Se llama solo cuando el agente las pide.
export async function fotosDeVisita(visitaId: string): Promise<FotoHistorial[]> {
  const { data, error } = await supabase
    .from("evidencias")
    .select("id, tipo, storage_path, bytes")
    .eq("visita_id", visitaId)
    .order("orden");
  if (error) throw error;

  const filas = data ?? [];
  if (filas.length === 0) return [];

  const rutas = filas.map((f: any) => f.storage_path);
  const { data: urls, error: eUrl } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(rutas, VIGENCIA_URL);
  if (eUrl) throw eUrl;

  const porRuta = new Map<string, string>();
  for (const u of urls ?? []) {
    if (u.signedUrl && u.path) porRuta.set(u.path, u.signedUrl);
  }

  return filas
    .map((f: any) => ({
      id: f.id,
      tipo: f.tipo,
      bytes: f.bytes,
      url: porRuta.get(f.storage_path) ?? "",
    }))
    .filter((f) => f.url); // una foto sin archivo no se muestra rota
}

// ---- utilidades de fecha ----

function sumarDia(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Fecha de hoy en horario de operación, como YYYY-MM-DD (para los inputs).
export function hoyLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function hoyMenosDias(dias: number): string {
  const d = new Date(`${hoyLocal()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}
