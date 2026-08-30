// Motor de sincronización: sube la cola offline a Supabase (Storage + DB).
//
// Garantías (ver reglas no negociables en CLAUDE.md):
//  * Nunca perder evidencia: una visita se marca "sincronizado" SOLO cuando el
//    servidor confirmó fotos + fila de visita + filas de evidencia. Si algo falla,
//    queda como "error" y se reintenta; nunca se borra sin confirmación.
//  * Idempotencia: cada visita y cada foto llevan UUID de cliente. Las subidas usan
//    upsert y los inserts usan onConflict/ignoreDuplicates, así reintentar no duplica.

import { supabase } from "../db/supabase";
import * as cola from "./cola";
import type { VisitaPendiente } from "./tipos";

const BUCKET = "evidencias";
let sincronizando = false;

// ---- ruta de las fotos en el Storage ---------------------------------------
//
// Legible a propósito, para poder entender el bucket sin cruzar UUIDs a mano:
//
//   bikes-shot/bodega-aurrera/3784-ba-1-de-mayo-08-30-2026/1639_panoramica_889a6a79.webp
//   └ cliente  └ cadena       └ clave-nombre-fecha         └ hora └ tipo └ id corto
//
// Decisiones:
//  * Cliente y cadena van por SLUG, no por nombre: el slug es estable, así que
//    renombrar la empresa no parte las carpetas ya escritas (ver 0005_slugs.sql).
//  * La tienda va con la CLAVE primero: es la llave del retailer y no cambia,
//    mientras que el nombre sí. Además ordena por número.
//  * La FECHA (mm-dd-aaaa) va en la carpeta de la tienda: así cada visita a una
//    tienda en un día queda en su propia carpeta y la gestión es directa.
//    Con guiones, no diagonales: en Storage una "/" crea carpetas anidadas.
//  * La HORA va en el archivo, para distinguir dos visitas a la misma tienda el
//    mismo día.
//  * El id corto de la foto al final es lo que conserva la IDEMPOTENCIA: la ruta
//    es siempre la misma para la misma foto, así que reintentar sobrescribe en
//    vez de duplicar.

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Fecha y hora REAL de captura, en horario de operación (America/Mexico_City).
// Determinista: depende solo de capturada_en, que se fija una vez al capturar y
// ya no cambia aunque el sync se reintente días después.
function partesFecha(iso: string): { fecha: string; hora: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return {
    fecha: `${g("month")}-${g("day")}-${g("year")}`, // mm-dd-aaaa
    hora: `${g("hour")}${g("minute")}`,
  };
}

function rutaFoto(v: VisitaPendiente, foto: { id: string; tipo: string }): string {
  // Respaldo por UUID para visitas encoladas ANTES de que existieran los slugs:
  // suben con la ruta vieja en vez de fallar. Nunca perder evidencia.
  if (!v.cliente_slug || !v.cadena_slug) {
    return `${v.cliente_id}/${v.id}/${foto.id}.webp`;
  }
  const { fecha, hora } = partesFecha(v.capturada_en);
  const tienda = slug(`${v.tienda_clave}-${v.tienda_nombre}-${fecha}`);
  const archivo = `${hora}_${slug(foto.tipo)}_${foto.id.slice(0, 8)}.webp`;
  return `${v.cliente_slug}/${v.cadena_slug}/${tienda}/${archivo}`;
}

// Avisa a la UI que la cola cambió (para refrescar contadores y la lista).
function notificar() {
  window.dispatchEvent(new CustomEvent("cola-cambio"));
}

// Sube una sola visita. Lanza si algo falla (para reintentar después).
async function subirVisita(v: VisitaPendiente): Promise<void> {
  // 1) Subir cada foto al Storage (ver rutaFoto: ruta legible y determinista).
  //    upsert:true -> reintentar sobre la misma ruta no duplica ni falla.
  const rutas: Record<string, string> = {};
  for (const foto of v.fotos) {
    const ruta = rutaFoto(v, foto);
    const { error } = await supabase.storage.from(BUCKET).upload(ruta, foto.blob, {
      contentType: "image/webp",
      upsert: true,
    });
    if (error) throw new Error(`Storage (${foto.tipo}): ${error.message}`);
    rutas[foto.id] = ruta;
  }

  // 2) Insertar la visita (idempotente por id de cliente).
  const { error: eVisita } = await supabase.from("visitas").upsert(
    {
      id: v.id,
      cliente_id: v.cliente_id,
      marca_id: v.marca_id,
      cadena_id: v.cadena_id,
      tienda_id: v.tienda_id,
      agente_id: v.agente_id,
      capturada_en: v.capturada_en,
      latitud: v.latitud,
      longitud: v.longitud,
      datos: v.datos,
      notas: v.notas || null,
    },
    { onConflict: "id", ignoreDuplicates: true }
  );
  if (eVisita) throw new Error(`Visita: ${eVisita.message}`);

  // 3) Insertar las evidencias (idempotente por id de cliente).
  const filas = v.fotos.map((foto, i) => ({
    id: foto.id,
    visita_id: v.id,
    cliente_id: v.cliente_id,
    tipo: foto.tipo,
    storage_path: rutas[foto.id],
    orden: i,
    ancho: foto.ancho,
    alto: foto.alto,
    bytes: foto.bytes,
  }));
  const { error: eEvid } = await supabase
    .from("evidencias")
    .upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  if (eEvid) throw new Error(`Evidencias: ${eEvid.message}`);
}

// Procesa toda la cola pendiente. Seguro llamarla muchas veces (no reentra).
export async function sincronizar(): Promise<void> {
  if (sincronizando) return;
  if (!navigator.onLine) return;
  sincronizando = true;
  try {
    const todas = await cola.listar();
    const pendientes = todas.filter(
      (v) => v.estado === "pendiente" || v.estado === "error"
    );
    for (const v of pendientes) {
      try {
        await subirVisita(v);
        await cola.guardar({
          ...v,
          estado: "sincronizado",
          subida_en: new Date().toISOString(),
          ultimo_error: undefined,
        });
      } catch (e) {
        await cola.guardar({
          ...v,
          estado: "error",
          ultimo_error: e instanceof Error ? e.message : String(e),
        });
      }
      notificar();
    }
  } finally {
    sincronizando = false;
    notificar();
  }
}

// Arranca la sincronización automática: al volver la señal y cada 30 s de respaldo.
export function iniciarSync(): void {
  window.addEventListener("online", () => {
    void sincronizar();
  });
  setInterval(() => {
    void sincronizar();
  }, 30_000);
  void sincronizar();
}
