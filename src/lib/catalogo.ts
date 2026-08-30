// Lecturas de catálogo desde Supabase: clientes, marcas, cadenas, tiendas, agentes.
// Todo filtrado por cliente_id — los datos de un cliente nunca se mezclan con otro.
// (En fase 1 el aislamiento es por consulta; en fase 2 lo refuerza la RLS.)
//
// Estrategia: RED PRIMERO, CACHE COMO RESPALDO (ver catalogo-cache.ts). El agente
// puede abrir la app sin señal dentro de una tienda y seguir teniendo su marca,
// sus tiendas y poder validar su PIN. Cuando hay red, el cache se refresca solo.

import { supabase } from "../db/supabase";
import * as cache from "./catalogo-cache";
import type { Cliente, Marca, Cadena, Tienda, Agente } from "./tipos";

export async function listarClientes(): Promise<Cliente[]> {
  return cache.redPrimero(cache.claves.clientes(), async () => {
    const { data, error } = await supabase
      .from("clientes")
      .select("id, nombre, slug")
      .eq("activo", true)
      .order("nombre");
    if (error) throw error;
    return data ?? [];
  });
}

export async function listarMarcas(clienteId: string): Promise<Marca[]> {
  return cache.redPrimero(cache.claves.marcas(clienteId), async () => {
    const { data, error } = await supabase
      .from("marcas")
      .select("id, cliente_id, nombre, config_captura")
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .order("nombre");
    if (error) throw error;
    return (data ?? []) as Marca[];
  });
}

export async function listarCadenas(clienteId: string): Promise<Cadena[]> {
  return cache.redPrimero(cache.claves.cadenas(clienteId), async () => {
    const { data, error } = await supabase
      .from("cadenas")
      .select("id, cliente_id, nombre, slug")
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .order("nombre");
    if (error) throw error;
    return data ?? [];
  });
}

// Tope defensivo de la descarga de tiendas. Con rutas de fase 1 (decenas o pocos
// cientos de sucursales) sobra; si un cliente lo rebasa, toca paginar.
const MAX_TIENDAS = 5000;

// Descarga TODAS las tiendas del cliente y las cachea. Se llama una vez al entrar.
// Bajar la lista completa (unos pocos KB) y buscar en local es más barato que
// consultar la red en cada tecla, y es lo único que funciona sin señal.
export async function listarTiendas(clienteId: string): Promise<Tienda[]> {
  return cache.redPrimero(cache.claves.tiendas(clienteId), async () => {
    const { data, error } = await supabase
      .from("tiendas")
      .select("id, cliente_id, cadena_id, clave_sucursal, nombre, cadenas(nombre, slug)")
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .order("nombre")
      .limit(MAX_TIENDAS);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      cliente_id: r.cliente_id,
      cadena_id: r.cadena_id,
      clave_sucursal: r.clave_sucursal,
      nombre: r.nombre,
      cadena_nombre: r.cadenas?.nombre,
      cadena_slug: r.cadenas?.slug,
    })) as Tienda[];
  });
}

// Normaliza para buscar sin acentos ni mayúsculas ("aurrera" encuentra "Aurrerá").
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita los acentos ya separados por NFD
    .toLowerCase()
    .trim();
}

// Búsqueda de tiendas del cliente por nombre o clave de sucursal.
// Filtra sobre el catálogo local: instantánea y funciona sin señal.
export async function buscarTiendas(
  clienteId: string,
  texto: string,
  limite = 20
): Promise<Tienda[]> {
  const todas = await listarTiendas(clienteId);
  const t = norm(texto);
  if (!t) return todas.slice(0, limite);
  return todas
    .filter(
      (x) =>
        norm(x.nombre ?? "").includes(t) ||
        norm(x.clave_sucursal).includes(t) ||
        norm(x.cadena_nombre ?? "").includes(t)
    )
    .slice(0, limite);
}

export async function listarAgentes(clienteId: string): Promise<Agente[]> {
  return cache.redPrimero(cache.claves.agentes(clienteId), async () => {
    // Agentes ligados a este cliente vía agente_cliente (N:N).
    // pin_salt/pin_hash vienen para poder validar el PIN sin señal (fase 1).
    const { data, error } = await supabase
      .from("agente_cliente")
      .select("agentes(id, nombre, activo, pin_salt, pin_hash)")
      .eq("cliente_id", clienteId);
    if (error) throw error;
    return (data ?? [])
      .map((r: any) => r.agentes)
      .filter((a: any) => a && a.activo !== false)
      .map((a: any) => ({
        id: a.id,
        nombre: a.nombre,
        pin_salt: a.pin_salt,
        pin_hash: a.pin_hash,
      }))
      .sort((a: Agente, b: Agente) => a.nombre.localeCompare(b.nombre, "es-MX"));
  });
}
