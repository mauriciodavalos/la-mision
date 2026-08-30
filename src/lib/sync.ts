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

// Avisa a la UI que la cola cambió (para refrescar contadores y la lista).
function notificar() {
  window.dispatchEvent(new CustomEvent("cola-cambio"));
}

// Sube una sola visita. Lanza si algo falla (para reintentar después).
async function subirVisita(v: VisitaPendiente): Promise<void> {
  // 1) Subir cada foto al Storage. Ruta: {cliente_id}/{visita_id}/{foto_id}.webp
  //    upsert:true -> reintentar sobre la misma ruta no duplica ni falla.
  const rutas: Record<string, string> = {};
  for (const foto of v.fotos) {
    const ruta = `${v.cliente_id}/${v.id}/${foto.id}.webp`;
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
