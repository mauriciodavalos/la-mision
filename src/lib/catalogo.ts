// Lecturas de catálogo desde Supabase: clientes, marcas, cadenas, tiendas, agentes.
//
// Dos filtros, siempre:
//  1. Por CLIENTE — los datos de un cliente nunca se mezclan con otro.
//  2. Por ASIGNACIÓN del agente — cada quien ve solo la marca y la cadena que le
//     tocan (ver 0006_asignaciones.sql). Un admin se salta este segundo filtro.
// (En fase 1 ambos son por consulta; en fase 2 los refuerza la RLS.)
//
// Estrategia: RED PRIMERO, CACHE COMO RESPALDO (ver catalogo-cache.ts). El agente
// puede abrir la app sin señal dentro de una tienda y seguir teniendo su marca,
// sus tiendas y poder validar su PIN. Cuando hay red, el cache se refresca solo.

import { supabase } from "../db/supabase";
import * as cache from "./catalogo-cache";
import type { Agente, Asignacion, Cliente, Marca, Cadena, Tienda } from "./tipos";

// Un cliente al que el agente puede entrar. Para un admin, todos los activos.
export async function listarClientes(agente?: Agente): Promise<Cliente[]> {
  const clave = cache.claves.clientes(agente?.id);
  return cache.redPrimero(clave, async () => {
    if (agente && !agente.es_admin) {
      // Solo los clientes donde tiene membresía (agente_cliente).
      const { data, error } = await supabase
        .from("agente_cliente")
        .select("clientes(id, nombre, slug, activo)")
        .eq("agente_id", agente.id);
      if (error) throw error;
      return (data ?? [])
        .map((r: any) => r.clientes)
        .filter((c: any) => c && c.activo !== false)
        .map((c: any) => ({ id: c.id, nombre: c.nombre, slug: c.slug }))
        .sort((a: Cliente, b: Cliente) => a.nombre.localeCompare(b.nombre, "es-MX"));
    }
    const { data, error } = await supabase
      .from("clientes")
      .select("id, nombre, slug")
      .eq("activo", true)
      .order("nombre");
    if (error) throw error;
    return data ?? [];
  });
}

// Asignaciones del agente en un cliente: qué marca, en qué cadena.
export async function listarAsignaciones(
  agenteId: string,
  clienteId: string
): Promise<Asignacion[]> {
  return cache.redPrimero(cache.claves.asignaciones(clienteId, agenteId), async () => {
    const { data, error } = await supabase
      .from("agente_asignacion")
      .select("marca_id, cadena_id")
      .eq("agente_id", agenteId)
      .eq("cliente_id", clienteId);
    if (error) throw error;
    return (data ?? []) as Asignacion[];
  });
}

// Marcas que el agente puede capturar en este cliente.
// Admin: todas. Resto: solo las que aparecen en sus asignaciones.
export async function listarMarcas(clienteId: string, agente?: Agente): Promise<Marca[]> {
  const todas = await cache.redPrimero(cache.claves.marcas(clienteId), async () => {
    const { data, error } = await supabase
      .from("marcas")
      .select("id, cliente_id, nombre, config_captura")
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .order("nombre");
    if (error) throw error;
    return (data ?? []) as Marca[];
  });

  if (!agente || agente.es_admin) return todas;

  const asignadas = new Set(
    (await listarAsignaciones(agente.id, clienteId)).map((a) => a.marca_id)
  );
  return todas.filter((m) => asignadas.has(m.id));
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

// Tiendas que el agente puede visitar con ESA marca. Admin: todas las del cliente.
// Resto: solo las de las cadenas que tiene asignadas para esa marca.
//
// Se descargan todas de una vez y se cachean: bajar la lista (unos pocos KB) y
// buscar en local es más barato que consultar la red en cada tecla, y es lo único
// que funciona sin señal.
export async function listarTiendas(
  clienteId: string,
  agente?: Agente,
  marcaId?: string
): Promise<Tienda[]> {
  let cadenas: string[] | null = null;

  if (agente && !agente.es_admin) {
    const asigs = await listarAsignaciones(agente.id, clienteId);
    const suyas = marcaId ? asigs.filter((a) => a.marca_id === marcaId) : asigs;
    cadenas = [...new Set(suyas.map((a) => a.cadena_id))];
    // Sin cadenas asignadas para esa marca no hay nada que mostrar. Se devuelve
    // vacío en vez de consultar sin filtro, que enseñaría tiendas ajenas.
    if (cadenas.length === 0) return [];
  }

  const clave = cache.claves.tiendas(clienteId, agente?.id, marcaId);
  return cache.redPrimero(clave, async () => {
    let q = supabase
      .from("tiendas")
      .select("id, cliente_id, cadena_id, clave_sucursal, nombre, cadenas(nombre, slug)")
      .eq("cliente_id", clienteId)
      .eq("activo", true)
      .order("nombre")
      .limit(MAX_TIENDAS);

    if (cadenas) q = q.in("cadena_id", cadenas);

    const { data, error } = await q;
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

// Búsqueda de tiendas por nombre o clave de sucursal, sobre el catálogo local:
// instantánea y funciona sin señal.
export async function buscarTiendas(
  clienteId: string,
  texto: string,
  limite = 20,
  agente?: Agente,
  marcaId?: string
): Promise<Tienda[]> {
  const todas = await listarTiendas(clienteId, agente, marcaId);
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

// Agentes que pueden aparecer en las visitas de UN cliente, para el filtro del
// panel de administración.
//
// Son los que tienen membresía en el cliente MÁS los administradores: un admin
// captura en cualquier empresa sin estar en `agente_cliente` (ver listarClientes),
// así que filtrar solo por membresía dejaría fuera visitas que sí existen — pasó
// el primer día, con visitas de un admin en un cliente donde no es miembro.
//
// Sin cache a propósito: el panel se usa con señal, y una membresía recién dada
// de alta debe verse al instante, no cuando expire una copia local.
export async function listarAgentesDeCliente(clienteId: string): Promise<Agente[]> {
  const todos = await listarAgentes();
  const { data, error } = await supabase
    .from("agente_cliente")
    .select("agente_id")
    .eq("cliente_id", clienteId);
  if (error) throw error;
  const miembros = new Set((data ?? []).map((r: any) => r.agente_id));
  return todos.filter((a) => miembros.has(a.id) || a.es_admin);
}

// Todos los agentes activos. La identificación empieza por el AGENTE y de ahí se
// deriva la empresa (ver identidad-ui.ts): el agente sabe cómo se llama, no en qué
// cliente está dado de alta.
//
// pin_salt/pin_hash vienen para poder validar el PIN sin señal (fase 1). Ver la
// nota de alcance en 0004_pin_agente.sql: en fase 1 esto es legible con la key
// publishable de todos modos.
export async function listarAgentes(): Promise<Agente[]> {
  return cache.redPrimero(cache.claves.agentes(), async () => {
    const { data, error } = await supabase
      .from("agentes")
      .select("id, nombre, activo, es_admin, pin_salt, pin_hash")
      .eq("activo", true)
      .order("nombre");
    if (error) throw error;
    return (data ?? []).map((a: any) => ({
      id: a.id,
      nombre: a.nombre,
      es_admin: a.es_admin === true,
      pin_salt: a.pin_salt,
      pin_hash: a.pin_hash,
    })) as Agente[];
  });
}
