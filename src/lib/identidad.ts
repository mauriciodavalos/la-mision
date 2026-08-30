// Identidad del agente en el dispositivo (FASE 1, sin auth).
//
// El agente elige su nombre y teclea su PIN de 4 dígitos UNA VEZ por dispositivo.
// La validación es 100% local (WebCrypto, cero dependencias) contra el salt/hash
// que vienen en el catálogo cacheado: funciona sin señal, que es el caso real en
// una tienda.
//
// Alcance honesto: esto evita que se capture con el nombre equivocado, sea por
// descuido o por comodidad. NO es una barrera contra alguien decidido — el hash
// es público y 4 dígitos se rompen por fuerza bruta en segundos (ver la nota en
// 0004_pin_agente.sql). La identidad real llega en fase 2 con Supabase Auth.

import type { Agente, Identidad } from "./tipos";
import * as cache from "./catalogo-cache";

const LLAVE = "lamision.identidad";

// sha256(pin || salt) en hex — misma fórmula que set_pin_agente() en la base.
async function hashPin(pin: string, salt: string): Promise<string> {
  const datos = new TextEncoder().encode(pin + salt);
  const buf = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Comparación en tiempo constante: no filtra por dónde difieren los hashes.
function igualesSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export interface ResultadoPin {
  ok: boolean;
  motivo?: "sin_pin" | "incorrecto" | "formato" | "sin_cripto";
}

export async function verificarPin(agente: Agente, pin: string): Promise<ResultadoPin> {
  // crypto.subtle solo existe en contexto seguro (https o localhost). Al probar
  // desde el celular contra http://192.168.x.x NO está, y sin esto el error sería
  // "PIN incorrecto" con el PIN correcto — media hora perdida buscando el bug.
  if (!globalThis.crypto?.subtle) return { ok: false, motivo: "sin_cripto" };
  if (!/^[0-9]{4}$/.test(pin)) return { ok: false, motivo: "formato" };
  if (!agente.pin_hash || !agente.pin_salt) {
    // El agente existe pero nadie le asignó PIN todavía (set_pin_agente).
    return { ok: false, motivo: "sin_pin" };
  }
  const calculado = await hashPin(pin, agente.pin_salt);
  return igualesSeguro(calculado, agente.pin_hash)
    ? { ok: true }
    : { ok: false, motivo: "incorrecto" };
}

// ---- persistencia en el dispositivo ----

export function leerIdentidad(): Identidad | null {
  try {
    const raw = localStorage.getItem(LLAVE);
    if (!raw) return null;
    const id = JSON.parse(raw) as Identidad;
    if (!id?.cliente_id || !id?.agente_id) return null;
    return id;
  } catch {
    // localStorage bloqueado (modo privado) o JSON corrupto: se vuelve a pedir el PIN.
    return null;
  }
}

export function guardarIdentidad(clienteId: string, agente: Agente): Identidad {
  const id: Identidad = {
    cliente_id: clienteId,
    agente_id: agente.id,
    agente_nombre: agente.nombre,
    desde: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LLAVE, JSON.stringify(id));
  } catch {
    // Si no se puede guardar, la sesión sigue viva en memoria; solo volverá a
    // pedir el PIN al recargar. Nunca bloquea la captura.
  }
  return id;
}

// Cierra la sesión del agente en este dispositivo.
// OJO: no toca la cola de visitas — la evidencia pendiente NUNCA se borra al
// cambiar de agente (regla no negociable: nunca perder evidencia).
export async function olvidarIdentidad(): Promise<void> {
  try {
    localStorage.removeItem(LLAVE);
  } catch {
    /* nada que hacer */
  }
  // El catálogo sí se limpia: el siguiente agente puede ser de otro cliente.
  await cache.limpiar();
}
