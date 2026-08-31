// Panel de administración: ver los registros y las fotos que YA están en el
// servidor, filtrando por empresa y por agente.
//
// Es la vista de quien administra, no la del agente. El "Historial" de la app de
// captura contesta "¿qué hice yo?"; esto contesta "¿qué hizo el equipo?".
//
// TRES REGLAS QUE EXPLICAN EL DISEÑO
//
// 1) NADA SE DESCARGA SOLO. Al abrir la página no se consulta ninguna visita:
//    hay que elegir empresa y tocar "Consultar". Es lo que se pidió, y además es
//    lo correcto en costo — abrir el panel "por si acaso" no debe gastar egress.
//
// 2) LAS FOTOS, UNA POR UNA Y BAJO DEMANDA. La lista es solo texto (~1 KB por
//    cada 10 visitas). Cada foto pesa ~200 KB, así que se piden al tocar "Ver
//    fotos" de esa visita. Cargar miniaturas de toda la lista convertiría un día
//    de trabajo del equipo en decenas de MB cada vez que alguien abre el panel.
//
// 3) UNA EMPRESA A LA VEZ. No hay opción de "todas": los datos de un cliente no
//    se mezclan con los de otro ni en la pantalla del administrador. Para ver la
//    otra empresa se cambia el filtro.
//
// ACTUALIZAR "EN TIEMPO REAL": el botón de abajo vuelve a consultar con los
// mismos filtros, y el interruptor "auto" lo repite cada minuto. NO se usa
// Supabase Realtime (websocket) a propósito: exigiría una migración para publicar
// la tabla y dejaría una conexión abierta por pestaña, a cambio de ganar segundos
// sobre un dato que de todos modos llega cuando el agente sincroniza. Si algún
// día hace falta el segundo exacto, el gancho es `supabase.channel(...)` sobre
// `visitas`.
//
// ALCANCE DE LA PUERTA: entra quien se identifique como agente con `es_admin`
// (mismo PIN de fase 1). Evita que un agente entre al panel por curiosidad o por
// equivocación; NO es una cerradura — con la RLS apagada, quien tenga la key
// publishable puede leer la base con o sin esta pantalla. La cerradura llega en
// fase 2 (Supabase Auth + RLS, ver 9999_rls_fase2.sql.txt).

import { listarAgentesDeCliente, listarClientes } from "./catalogo";
import { asegurarIdentidad } from "./identidad-ui";
import { olvidarIdentidad } from "./identidad";
import {
  fotosDeVisita,
  hoyLocal,
  hoyMenosDias,
  listarVisitas,
  type VisitaHistorial,
} from "./historial";
import type { Agente, Cliente } from "./tipos";

const LLAVE_FILTROS = "lamision.panel.filtros";
const AUTO_MS = 60_000;

const estado = {
  admin: null as Agente | null,
  clientes: [] as Cliente[],
  agentes: [] as Agente[],
  visitas: [] as VisitaHistorial[],
  consultado: false,
  cargando: false,
  ultima: null as Date | null,
};

let timerAuto: number | null = null;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T | null;

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function fmtFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

function fmtHora(d: Date): string {
  return d.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

// ---- filtros recordados en este equipo ----
interface Filtros {
  cliente: string;
  agente: string;
  desde: string;
  hasta: string;
}

function leerFiltros(): Partial<Filtros> {
  try {
    return JSON.parse(localStorage.getItem(LLAVE_FILTROS) ?? "{}");
  } catch {
    return {};
  }
}

function guardarFiltros(f: Filtros) {
  try {
    localStorage.setItem(LLAVE_FILTROS, JSON.stringify(f));
  } catch {
    /* modo privado: los filtros solo no se recuerdan, nada más */
  }
}

function filtrosActuales(): Filtros {
  return {
    cliente: ($("#f-cliente") as HTMLSelectElement | null)?.value ?? "",
    agente: ($("#f-agente") as HTMLSelectElement | null)?.value ?? "",
    desde: ($("#f-desde") as HTMLInputElement | null)?.value ?? "",
    hasta: ($("#f-hasta") as HTMLInputElement | null)?.value ?? "",
  };
}

// ---- pantalla para quien no es administrador ----
function pantallaSoloAdmin(root: HTMLElement, agente: Agente) {
  root.innerHTML = `
    <header class="bs-head">
      <div class="bs-shell" style="padding-bottom:18px">
        <p class="bs-brand">La Misión · Panel</p>
        <h1 class="bs-title">Solo para<br>administradores</h1>
      </div>
    </header>
    <main class="bs-shell"><div class="bs-body">
      <section class="bs-field">
        <p class="bs-hint" style="margin-left:0">
          Entraste como <strong>${esc(agente.nombre)}</strong>, que no tiene permiso de
          administrador. Este panel muestra el trabajo de todo el equipo, así que solo
          lo abre quien administra.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="bs-mini" id="panel-cambiar">Entrar con otro agente</button>
          <a class="bs-mini" href="/captura" style="text-decoration:none">Ir a capturar</a>
        </div>
      </section>
    </div></main>`;
  $("#panel-cambiar")!.addEventListener("click", async () => {
    await olvidarIdentidad();
    location.reload();
  });
}

// ---- esqueleto ----
function montar(root: HTMLElement) {
  const f = leerFiltros();
  const cli = estado.clientes.find((c) => c.id === f.cliente)?.id ?? "";

  root.innerHTML = `
    <header class="bs-head">
      <div class="bs-shell is-wide" style="padding-bottom:18px">
        <div class="bs-head-top">
          <div>
            <p class="bs-brand">La Misión · Panel</p>
            <h1 class="bs-title">Registros<br>de campo</h1>
            <p class="bs-quien">
              <span>${esc(estado.admin?.nombre ?? "")}</span>
              <span class="bs-admin">admin</span>
              <a class="bs-quien-btn" href="/captura" style="text-decoration:none">ir a capturar</a>
            </p>
          </div>
          <span class="bs-chip is-on" id="chip">
            <span class="bs-dot is-live"></span><span id="chip-txt">En línea</span>
          </span>
        </div>
      </div>
    </header>

    <main class="bs-shell is-wide"><div class="bs-body">
      <section class="bs-field">
        <div class="bs-legend"><span class="bs-num">01</span>
          <h2 class="bs-label">Qué quieres ver</h2></div>
        <p class="bs-hint">
          Nada se descarga hasta que toques <strong>Consultar</strong>. Una empresa a la
          vez: los datos de un cliente no se mezclan con los de otro.
        </p>
        <div class="bs-inner">
          <div class="bs-filtros">
            <label class="bs-campo">
              <span class="bs-campo-l">Empresa</span>
              <select class="bs-select" id="f-cliente">
                <option value="">— elige —</option>
                ${estado.clientes
                  .map(
                    (c) =>
                      `<option value="${esc(c.id)}"${
                        c.id === cli ? " selected" : ""
                      }>${esc(c.nombre)}</option>`
                  )
                  .join("")}
              </select>
            </label>
            <label class="bs-campo">
              <span class="bs-campo-l">Agente</span>
              <select class="bs-select" id="f-agente" disabled>
                <option value="">Todos</option>
              </select>
            </label>
            <label class="bs-campo">
              <span class="bs-campo-l">Desde</span>
              <input class="bs-input" type="date" id="f-desde" value="${esc(
                f.desde || hoyMenosDias(7)
              )}">
            </label>
            <label class="bs-campo">
              <span class="bs-campo-l">Hasta</span>
              <input class="bs-input" type="date" id="f-hasta" value="${esc(
                f.hasta || hoyLocal()
              )}">
            </label>
          </div>
          <button class="bs-submit" id="btn-consultar" style="margin-top:6px" disabled>
            Consultar
          </button>
        </div>
      </section>
      <div id="panel-resultados"></div>
    </div></main>

    <div class="bs-queue">
      <div class="bs-queue-in">
        <div class="bs-queue-l">
          <span class="bs-queue-n is-clear" id="panel-n">00</span>
          <span class="bs-queue-t">Visitas a la vista
            <span class="bs-queue-s" id="panel-sub">Sin consultar</span></span>
        </div>
        <div class="bs-queue-r">
          <label class="bs-auto">
            <input type="checkbox" id="f-auto">
            <span>auto 1 min</span>
          </label>
          <button class="bs-toggle" id="btn-actualizar">Actualizar</button>
        </div>
      </div>
    </div>`;

  $("#f-cliente")!.addEventListener("change", () => void alCambiarCliente());
  $("#btn-consultar")!.addEventListener("click", () => void consultar());
  $("#btn-actualizar")!.addEventListener("click", () => void consultar());
  $("#f-auto")!.addEventListener("change", alCambiarAuto);
  $("#f-agente")!.addEventListener("change", recordar);
  $("#f-desde")!.addEventListener("change", recordar);
  $("#f-hasta")!.addEventListener("change", recordar);

  window.addEventListener("online", refrescarChip);
  window.addEventListener("offline", refrescarChip);
  refrescarChip();
  vaciarResultados();

  // Si había una empresa recordada, se repuebla el selector de agentes — pero
  // NO se consulta: la descarga siempre la dispara quien mira el panel.
  if (cli) void alCambiarCliente(f.agente);
}

function refrescarChip() {
  const chip = $("#chip");
  if (!chip) return;
  const enLinea = navigator.onLine;
  chip.className = "bs-chip " + (enLinea ? "is-on" : "is-off");
  $("#chip-txt")!.textContent = enLinea ? "En línea" : "Sin conexión";
}

function recordar() {
  guardarFiltros(filtrosActuales());
}

// ---- filtro de agentes, dependiente de la empresa ----
async function alCambiarCliente(agentePreferido?: string) {
  const sel = $("#f-agente") as HTMLSelectElement;
  const clienteId = ($("#f-cliente") as HTMLSelectElement).value;
  const btn = $("#btn-consultar") as HTMLButtonElement;

  // Lo que está en pantalla es de la empresa anterior: se limpia, para que nadie
  // lea las cifras de un cliente bajo el nombre de otro.
  estado.visitas = [];
  estado.consultado = false;
  vaciarResultados();

  btn.disabled = !clienteId;
  sel.innerHTML = `<option value="">Todos</option>`;
  sel.disabled = true;
  if (!clienteId) return;

  try {
    estado.agentes = await listarAgentesDeCliente(clienteId);
    sel.innerHTML =
      `<option value="">Todos</option>` +
      estado.agentes
        .map(
          (a) =>
            `<option value="${esc(a.id)}"${
              a.id === agentePreferido ? " selected" : ""
            }>${esc(a.nombre)}${a.es_admin ? " (admin)" : ""}</option>`
        )
        .join("");
    sel.disabled = false;
  } catch {
    // Sin red no hay lista de agentes; se puede consultar igual, sin ese filtro.
    sel.innerHTML = `<option value="">Todos</option>`;
  }
  recordar();
}

function alCambiarAuto() {
  const on = ($("#f-auto") as HTMLInputElement).checked;
  if (timerAuto !== null) {
    window.clearInterval(timerAuto);
    timerAuto = null;
  }
  if (on) {
    timerAuto = window.setInterval(() => {
      // Con la pestaña en segundo plano no se consulta: no hay quién lo lea y
      // gasta cuota. Al volver, el siguiente tick la pone al día.
      if (document.hidden || estado.cargando || !estado.consultado) return;
      void consultar(true);
    }, AUTO_MS);
  }
  actualizarBarra();
}

// ---- consulta ----
async function consultar(silenciosa = false) {
  const cont = $("#panel-resultados")!;
  const f = filtrosActuales();
  guardarFiltros(f);

  if (!f.cliente) {
    cont.innerHTML = aviso("Elige una empresa para consultar.");
    return;
  }
  if (!f.desde || !f.hasta || f.desde > f.hasta) {
    cont.innerHTML = aviso(
      "Revisa el rango: la fecha inicial no puede ser posterior a la final."
    );
    return;
  }
  if (!navigator.onLine) {
    cont.innerHTML = aviso(
      "El panel lee del servidor, así que necesita señal. Vuelve a intentar cuando haya conexión."
    );
    return;
  }

  estado.cargando = true;
  if (!silenciosa) cont.innerHTML = aviso("Consultando…");
  actualizarBarra();

  try {
    estado.visitas = await listarVisitas(f.cliente, f.desde, f.hasta, f.agente || undefined);
    estado.consultado = true;
    estado.ultima = new Date();
    renderResultados();
  } catch (e) {
    cont.innerHTML = aviso(
      "No se pudo consultar: " + (e instanceof Error ? e.message : String(e)),
      true
    );
  } finally {
    estado.cargando = false;
    actualizarBarra();
  }
}

function aviso(texto: string, error = false): string {
  return `<section class="bs-field"><p class="bs-hint" style="margin-left:0${
    error ? ";color:#C4462B" : ""
  }">${esc(texto)}</p></section>`;
}

function vaciarResultados() {
  $("#panel-resultados")!.innerHTML = `
    <div class="bs-empty">
      <p class="bs-empty-h">Nada descargado todavía</p>
      <p class="bs-empty-p">Elige empresa, agente y fechas, y toca Consultar.<br>
      El panel no baja nada por su cuenta.</p>
    </div>`;
  actualizarBarra();
}

function renderResultados() {
  const cont = $("#panel-resultados")!;
  const visitas = estado.visitas;
  const nombreCliente =
    estado.clientes.find((c) => c.id === filtrosActuales().cliente)?.nombre ?? "";

  if (visitas.length === 0) {
    cont.innerHTML = `
      <div class="bs-empty">
        <p class="bs-empty-h">Sin visitas en ese rango</p>
        <p class="bs-empty-p">${esc(nombreCliente)} no tiene visitas sincronizadas con
        esos filtros. Ojo: lo que un agente capturó y todavía no sube no aparece aquí —
        vive en su teléfono hasta que sincroniza.</p>
      </div>`;
    return;
  }

  // Desglose por agente: lo que se pregunta quien administra es "¿quién trabajó?",
  // no solo "¿cuántas visitas hubo?".
  const porAgente = new Map<string, number>();
  for (const v of visitas) {
    const k = v.agente_nombre ?? "(sin nombre)";
    porAgente.set(k, (porAgente.get(k) ?? 0) + 1);
  }

  const filas = visitas
    .map((v) => {
      const gps =
        v.latitud != null && v.longitud != null
          ? `<a href="https://www.google.com/maps?q=${v.latitud},${v.longitud}"
               target="_blank" rel="noopener">${v.latitud.toFixed(4)}, ${v.longitud.toFixed(
              4
            )}</a>`
          : `<span style="color:#C4462B">sin gps</span>`;
      const meta = [
        `No. ${esc(v.tienda_clave)}`,
        v.cadena_nombre ? esc(v.cadena_nombre) : "",
        v.marca_nombre ? esc(v.marca_nombre) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <article class="bs-row" style="grid-template-columns:1fr">
          <div>
            <div class="bs-row-name">${esc(v.tienda_nombre ?? "(sin nombre)")}</div>
            <div class="bs-row-meta">${meta}<br>
              ${fmtFechaHora(v.capturada_en)} · ${esc(v.agente_nombre ?? "?")} ·
              ${gps} · ${v.fotos} foto(s)</div>
            ${
              v.notas
                ? `<div class="bs-row-meta" style="color:#14181B">“${esc(v.notas)}”</div>`
                : ""
            }
            <button class="bs-mini" data-visita="${esc(
              v.id
            )}" style="margin-top:8px">Ver fotos</button>
            <div class="bs-thumbs" id="fotos-${esc(v.id)}" style="margin-top:8px"></div>
          </div>
        </article>`;
    })
    .join("");

  const sinGps = visitas.filter((v) => v.latitud == null).length;

  cont.innerHTML = `
    <div class="bs-stats bs-stats-4">
      <div class="bs-stat"><div class="bs-stat-n">${
        visitas.length
      }</div><div class="bs-stat-k">Visitas</div></div>
      <div class="bs-stat"><div class="bs-stat-n">${
        new Set(visitas.map((v) => v.tienda_clave)).size
      }</div><div class="bs-stat-k">Tiendas</div></div>
      <div class="bs-stat"><div class="bs-stat-n">${
        porAgente.size
      }</div><div class="bs-stat-k">Agentes</div></div>
      <div class="bs-stat"><div class="bs-stat-n">${visitas.reduce(
        (s, v) => s + v.fotos,
        0
      )}</div><div class="bs-stat-k">Fotos</div></div>
    </div>
    <p class="bs-row-meta" style="padding:12px 0 0">
      ${[...porAgente.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `${esc(n)}: ${c}`)
        .join(" · ")}${
    sinGps ? ` · <span style="color:#C4462B">${sinGps} sin gps</span>` : ""
  }</p>
    <div class="bs-rows">${filas}</div>
    <p class="bs-note">Las fotos no se descargan solas: cada una pesa unos 200 KB y se
    piden al tocar “Ver fotos”. Lo que un agente todavía no sincroniza no aparece aquí,
    aunque ya lo haya capturado: vive en su teléfono hasta que hay señal.</p>`;

  cont.querySelectorAll<HTMLButtonElement>("[data-visita]").forEach((btn) => {
    btn.addEventListener("click", () => void verFotos(btn));
  });
  actualizarBarra();
}

function actualizarBarra() {
  const n = $("#panel-n");
  const sub = $("#panel-sub");
  if (!n || !sub) return;

  const total = estado.visitas.length;
  n.textContent = String(total).padStart(2, "0");
  n.className = "bs-queue-n" + (total ? "" : " is-clear");

  if (estado.cargando) {
    sub.textContent = "Consultando…";
    return;
  }
  if (!estado.consultado) {
    sub.textContent = "Sin consultar";
    return;
  }
  const auto = ($("#f-auto") as HTMLInputElement | null)?.checked;
  sub.textContent =
    (estado.ultima ? `Actualizado ${fmtHora(estado.ultima)}` : "") +
    (auto ? " · auto cada minuto" : "");
}

// ---- fotos de una visita, bajo demanda ----
async function verFotos(btn: HTMLButtonElement) {
  const id = btn.dataset.visita!;
  const cont = document.getElementById("fotos-" + id);
  if (!cont) return;
  if (cont.childElementCount > 0) {
    // Segundo toque: ocultar, para no dejar la lista pesada.
    cont.innerHTML = "";
    btn.textContent = "Ver fotos";
    return;
  }
  btn.textContent = "Cargando…";
  try {
    const fotos = await fotosDeVisita(id);
    cont.innerHTML = fotos
      .map(
        (f) =>
          `<a href="${f.url}" target="_blank" rel="noopener" title="${esc(f.tipo)}">
             <img class="bs-thumb" src="${f.url}" alt="${esc(f.tipo)}" loading="lazy">
           </a>`
      )
      .join("");
    btn.textContent = fotos.length ? "Ocultar fotos" : "Sin fotos";
  } catch {
    btn.textContent = "No se pudieron cargar";
  }
}

// ---- init ----
export async function init() {
  const root = document.getElementById("app");
  if (!root) return;

  // Misma identificación que la app de captura: nombre, empresa y PIN.
  const ctx = await asegurarIdentidad(root);
  if (!ctx) return;

  if (!ctx.agente.es_admin) {
    pantallaSoloAdmin(root, ctx.agente);
    return;
  }

  estado.admin = ctx.agente;
  try {
    estado.clientes = await listarClientes(ctx.agente);
  } catch {
    estado.clientes = [];
  }
  montar(root);
}
