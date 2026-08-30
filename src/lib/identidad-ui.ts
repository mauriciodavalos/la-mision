// Pantalla de identificación del agente (FASE 1). Se muestra ANTES del formulario
// de captura y solo la primera vez en cada dispositivo: el agente elige su nombre,
// teclea su PIN de 4 dígitos y ya no se le vuelve a pedir.
//
// Todo se resuelve contra el catálogo cacheado (ver catalogo-cache.ts), así que
// funciona sin señal siempre que el dispositivo se haya conectado una vez.

import { listarAgentes, listarClientes } from "./catalogo";
import { guardarIdentidad, leerIdentidad, verificarPin } from "./identidad";
import type { Agente, Cliente } from "./tipos";

export interface Contexto {
  cliente: Cliente;
  agente: Agente;
}

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 30_000;

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Pantalla de error dura (sin catálogo, sin clientes, sin agentes): sin salida,
// pero explica exactamente qué falta para que se pueda arreglar.
function pantallaError(root: HTMLElement, titulo: string, detalle: string) {
  root.innerHTML = `
    <header class="bs-head">
      <div class="bs-shell" style="padding-bottom:18px">
        <p class="bs-brand">La Misión</p>
        <h1 class="bs-title">${esc(titulo)}</h1>
      </div>
    </header>
    <main class="bs-shell"><div class="bs-body">
      <section class="bs-field"><p class="bs-hint" style="margin-left:0">${esc(detalle)}</p></section>
    </div></main>`;
}

// Resuelve en qué cliente y como qué agente se va a capturar.
// Devuelve null si no se pudo (ya dejó una pantalla de error puesta).
export async function asegurarIdentidad(root: HTMLElement): Promise<Contexto | null> {
  let clientes: Cliente[];
  try {
    clientes = await listarClientes();
  } catch (e) {
    pantallaError(
      root,
      "Sin catálogo",
      "No se pudo leer el catálogo y este dispositivo no tiene una copia descargada. " +
        "Conéctate a internet una vez y vuelve a abrir la app."
    );
    return null;
  }

  if (clientes.length === 0) {
    pantallaError(
      root,
      "Sin clientes",
      "Todavía no hay clientes dados de alta. Corre supabase/alta_cliente.sql para dar de alta el primero."
    );
    return null;
  }

  // ¿Ya hay un agente identificado en este dispositivo?
  const guardada = leerIdentidad();
  if (guardada) {
    const cliente = clientes.find((c) => c.id === guardada.cliente_id);
    if (cliente) {
      try {
        const agentes = await listarAgentes(cliente.id);
        const agente = agentes.find((a) => a.id === guardada.agente_id);
        // Si el agente fue dado de baja, cae al formulario de identificación.
        if (agente) return { cliente, agente };
      } catch {
        /* sin catálogo de agentes: se vuelve a pedir identificación */
      }
    }
  }

  return pedirIdentificacion(root, clientes);
}

function pedirIdentificacion(root: HTMLElement, clientes: Cliente[]): Promise<Contexto | null> {
  return new Promise((resolve) => {
    let cliente = clientes[0];
    let agentes: Agente[] = [];
    let intentos = 0;
    let bloqueadoHasta = 0;

    root.innerHTML = `
      <header class="bs-head">
        <div class="bs-shell" style="padding-bottom:18px">
          <p class="bs-brand">La Misión</p>
          <h1 class="bs-title">¿Quién<br>captura?</h1>
        </div>
      </header>
      <main class="bs-shell"><div class="bs-body">
        <div id="ident-cliente"></div>
        <section class="bs-field">
          <div class="bs-legend"><span class="bs-num">01</span>
            <h2 class="bs-label">Agente <span class="bs-req">*</span></h2></div>
          <div class="bs-inner"><select class="bs-select" id="ident-agente"></select></div>
        </section>
        <section class="bs-field">
          <div class="bs-legend"><span class="bs-num">02</span>
            <h2 class="bs-label">Tu PIN <span class="bs-req">*</span></h2></div>
          <p class="bs-hint">4 dígitos. Solo se pide una vez en este teléfono.</p>
          <div class="bs-inner">
            <div class="bs-pin" id="ident-pin">
              ${[0, 1, 2, 3]
                .map(
                  (i) =>
                    `<input class="bs-pin-box" type="password" inputmode="numeric" autocomplete="off"
                       maxlength="1" data-i="${i}" aria-label="Dígito ${i + 1} del PIN">`
                )
                .join("")}
            </div>
          </div>
        </section>
        <button class="bs-submit" id="ident-entrar" disabled>Entrar</button>
        <p class="bs-missing" id="ident-msg"></p>
      </div></main>`;

    const selAgente = root.querySelector("#ident-agente") as HTMLSelectElement;
    const btn = root.querySelector("#ident-entrar") as HTMLButtonElement;
    const msg = root.querySelector("#ident-msg") as HTMLElement;
    const cajas = Array.from(
      root.querySelectorAll<HTMLInputElement>(".bs-pin-box")
    );

    const pin = () => cajas.map((c) => c.value).join("");

    function aviso(texto: string, error = true) {
      msg.style.color = error ? "#C4462B" : "#5C6660";
      msg.textContent = texto;
    }

    function revisar() {
      const listo = pin().length === 4 && !!selAgente.value && Date.now() >= bloqueadoHasta;
      btn.disabled = !listo;
    }

    // ---- PIN: avance y retroceso automáticos entre casillas ----
    cajas.forEach((caja, i) => {
      caja.addEventListener("input", () => {
        caja.value = caja.value.replace(/\D/g, "").slice(0, 1);
        if (caja.value && i < cajas.length - 1) cajas[i + 1].focus();
        revisar();
      });
      caja.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !caja.value && i > 0) cajas[i - 1].focus();
        if (e.key === "Enter" && !btn.disabled) btn.click();
      });
      // Pegar el PIN completo en cualquier casilla lo reparte.
      caja.addEventListener("paste", (e) => {
        const txt = (e.clipboardData?.getData("text") ?? "").replace(/\D/g, "");
        if (!txt) return;
        e.preventDefault();
        cajas.forEach((c, j) => (c.value = txt[j] ?? ""));
        cajas[Math.min(txt.length, cajas.length - 1)].focus();
        revisar();
      });
    });

    function limpiarPin() {
      cajas.forEach((c) => (c.value = ""));
      cajas[0].focus();
      revisar();
    }

    // ---- carga de agentes del cliente elegido ----
    async function cargarAgentes() {
      try {
        agentes = await listarAgentes(cliente.id);
      } catch {
        agentes = [];
      }
      if (agentes.length === 0) {
        selAgente.innerHTML = `<option value="">(sin agentes)</option>`;
        aviso(
          "Este cliente no tiene agentes ligados. Revisa la tabla agente_cliente."
        );
      } else {
        selAgente.innerHTML = agentes
          .map((a) => `<option value="${esc(a.id)}">${esc(a.nombre)}</option>`)
          .join("");
      }
      revisar();
    }

    // Selector de cliente solo si hay más de uno (un agente puede trabajar para
    // varios clientes). Con uno solo no se muestra: no hay nada que elegir.
    if (clientes.length > 1) {
      const cont = root.querySelector("#ident-cliente")!;
      cont.innerHTML = `
        <section class="bs-field">
          <div class="bs-legend"><span class="bs-num">··</span><h2 class="bs-label">Cliente</h2></div>
          <div class="bs-inner"><select class="bs-select" id="ident-cliente-sel">
            ${clientes.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("")}
          </select></div>
        </section>`;
      (cont.querySelector("#ident-cliente-sel") as HTMLSelectElement).addEventListener(
        "change",
        (e) => {
          const id = (e.target as HTMLSelectElement).value;
          cliente = clientes.find((c) => c.id === id) ?? cliente;
          limpiarPin();
          void cargarAgentes();
        }
      );
    }

    selAgente.addEventListener("change", () => {
      limpiarPin();
      revisar();
    });

    btn.addEventListener("click", async () => {
      if (Date.now() < bloqueadoHasta) return;
      const agente = agentes.find((a) => a.id === selAgente.value);
      if (!agente) return;

      const r = await verificarPin(agente, pin());
      if (r.ok) {
        guardarIdentidad(cliente.id, agente);
        resolve({ cliente, agente });
        return;
      }

      if (r.motivo === "sin_cripto") {
        aviso(
          "Este navegador no puede validar el PIN porque la página no se abrió en un " +
            "contexto seguro. Ábrela en https o en localhost (no por IP local)."
        );
        return;
      }

      if (r.motivo === "sin_pin") {
        aviso(
          `${agente.nombre} no tiene PIN asignado. Pídele a tu coordinador que lo dé de alta.`
        );
        limpiarPin();
        return;
      }

      intentos++;
      limpiarPin();
      if (intentos >= MAX_INTENTOS) {
        // Freno simple contra tanteo a ojo. No pretende ser una barrera real:
        // el hash es público en fase 1 (ver 0004_pin_agente.sql).
        bloqueadoHasta = Date.now() + BLOQUEO_MS;
        intentos = 0;
        btn.disabled = true;
        aviso("Demasiados intentos. Espera 30 segundos.");
        window.setTimeout(() => {
          aviso("Ya puedes intentar de nuevo.", false);
          revisar();
        }, BLOQUEO_MS);
        return;
      }
      aviso(`PIN incorrecto. Te quedan ${MAX_INTENTOS - intentos} intentos.`);
    });

    void cargarAgentes().then(() => cajas[0].focus());
  });
}
