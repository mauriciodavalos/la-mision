// Lecturas de catálogo desde Supabase: clientes, marcas, cadenas, tiendas, agentes.
// Todo filtrado por cliente_id — los datos de un cliente nunca se mezclan con otro.
// (En fase 1 el aislamiento es por consulta; en fase 2 lo refuerza la RLS.)

import { supabase } from "../db/supabase";
import type { Cliente, Marca, Cadena, Tienda, Agente } from "./tipos";

export async function listarClientes(): Promise<Cliente[]> {
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");
  if (error) throw error;
  return data ?? [];
}

export async function listarMarcas(clienteId: string): Promise<Marca[]> {
  const { data, error } = await supabase
    .from("marcas")
    .select("id, cliente_id, nombre, config_captura")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .order("nombre");
  if (error) throw error;
  return (data ?? []) as Marca[];
}

export async function listarCadenas(clienteId: string): Promise<Cadena[]> {
  const { data, error } = await supabase
    .from("cadenas")
    .select("id, cliente_id, nombre")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .order("nombre");
  if (error) throw error;
  return data ?? [];
}

// Búsqueda de tiendas del cliente por nombre o clave de sucursal.
export async function buscarTiendas(
  clienteId: string,
  texto: string,
  limite = 20
): Promise<Tienda[]> {
  let q = supabase
    .from("tiendas")
    .select("id, cliente_id, cadena_id, clave_sucursal, nombre, cadenas(nombre)")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .limit(limite);

  const t = texto.trim();
  if (t) {
    // Coincidencia en nombre o en clave de sucursal.
    q = q.or(`nombre.ilike.%${t}%,clave_sucursal.ilike.%${t}%`);
  }
  q = q.order("nombre");

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    cliente_id: r.cliente_id,
    cadena_id: r.cadena_id,
    clave_sucursal: r.clave_sucursal,
    nombre: r.nombre,
    cadena_nombre: r.cadenas?.nombre,
  }));
}

export async function listarAgentes(clienteId: string): Promise<Agente[]> {
  // Agentes ligados a este cliente vía agente_cliente (N:N).
  const { data, error } = await supabase
    .from("agente_cliente")
    .select("agentes(id, nombre)")
    .eq("cliente_id", clienteId);
  if (error) throw error;
  return (data ?? [])
    .map((r: any) => r.agentes)
    .filter(Boolean)
    .map((a: any) => ({ id: a.id, nombre: a.nombre }));
}
