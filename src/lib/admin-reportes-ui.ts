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
// CORREGIR LA TIENDA DE UNA VISITA: el panel no es solo de lectura. Una agente
// puede elegir la sucursal equivocada al capturar —pasó el 4 sep 2026, con dos
// Sanborns de nombre parecido a 8 metros— y hasta entonces la única forma de
// arreglarlo era entrar a la base a mano. El botón "Corregir tienda" de cada
// renglón lo resuelve desde aquí, dejando rastro. Las reglas del cambio viven
// en corregir-visita.ts; esta pantalla solo lo maneja.
//
// ALCANCE DE LA PUERTA: entra quien se identifique como agente con `es_admin`
// (mismo PIN de fase 1). Evita que un agente entre al panel por curiosidad o por
// equivocación; NO es una cerradura — con la RLS apagada, quien tenga la key
// publishable puede leer la base con o sin esta pantalla. La cerradura llega en
// fase 2 (Supabase Auth + RLS, ver 9999_rls_fase2.sql.txt).

import { buscarTiendas, listarAgentesDeCliente, listarClientes } from "./catalogo";
import { asegurarIdentidad } from "./identidad-ui";
import { olvidarIdentidad } from "./identidad";
import {
  fotosDeVisita,
  hoyLocal,
  hoyMenosDias,
  listarVisitas,
  type VisitaHistorial,
} from "./historial";
import {
  corregirTienda,
  historialDeCorrecciones,
  type VisitaCorregible,
} from "./corregir-visita";
import type { Agente, Cliente, Tienda } from "./tipos";

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
    </div>

    <div class="bs-toast" id="panel-toast" role="status" aria-live="polite"></div>`;

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
      // Una visita corregida lo dice en su renglón: en un producto de auditoría
      // no puede parecer que siempre estuvo así.
      const corr = historialDeCorrecciones(v.datos);
      const marca = corr.length
        ? `<div class="bs-row-meta bs-corregida">tienda corregida por ${esc(
            corr[corr.length - 1].por
          )} · ${fmtFechaHora(corr[corr.length - 1].en)}${
            corr[corr.length - 1].de_clave
              ? ` · antes ${esc(corr[corr.length - 1].de_clave!)}`
              : ""
          }</div>`
        : "";
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
            ${marca}
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              <button class="bs-mini" data-visita="${esc(v.id)}">Ver fotos</button>
              <button class="bs-mini" data-corregir="${esc(
                v.id
              )}">Corregir tienda</button>
            </div>
            <div class="bs-thumbs" id="fotos-${esc(v.id)}" style="margin-top:8px"></div>
            <div class="bs-corr" id="corr-${esc(v.id)}"></div>
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
  cont.querySelectorAll<HTMLButtonElement>("[data-corregir]").forEach((btn) => {
    btn.addEventListener("click", () => abrirCorrector(btn));
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

// ---- corregir la tienda de una visita ----
//
// Dos toques, nunca uno: se busca y se elige, y recién entonces aparece el
// "Confirmar" con las dos sucursales escritas completas. Un solo toque sobre una
// lista de nombres parecidos es exactamente el error que estamos corrigiendo.

function comoCorregible(v: VisitaHistorial): VisitaCorregible {
  return {
    id: v.id,
    cliente_id: v.cliente_id,
    tienda_id: v.tienda_id,
    cadena_id: v.cadena_id,
    tienda_clave: v.tienda_clave,
    tienda_nombre: v.tienda_nombre,
    datos: v.datos,
  };
}

function abrirCorrector(btn: HTMLButtonElement) {
  const id = btn.dataset.corregir!;
  const caja = document.getElementById("corr-" + id);
  const v = estado.visitas.find((x) => x.id === id);
  if (!caja || !v) return;

  if (caja.childElementCount > 0) {
    caja.innerHTML = "";
    btn.textContent = "Corregir tienda";
    return;
  }
  btn.textContent = "Cerrar";
  caja.innerHTML = `
    <div class="bs-corr-in">
      <p class="bs-hint" style="margin-left:0">
        Ahora está en <strong>${esc(v.tienda_clave)} ${esc(
    v.tienda_nombre ?? ""
  )}</strong>. Busca la sucursal correcta por clave o por nombre.
      </p>
      <label class="bs-campo">
        <span class="bs-campo-l">Tienda correcta</span>
        <input class="bs-input" id="q-${esc(id)}" autocomplete="off"
               placeholder="clave o nombre">
      </label>
      <label class="bs-campo">
        <span class="bs-campo-l">Por qué (opcional)</span>
        <input class="bs-input" id="m-${esc(id)}" autocomplete="off"
               placeholder="p. ej. la agente lo reportó">
      </label>
      <div class="bs-corr-lista" id="l-${esc(id)}"></div>
      <p class="bs-note">Las fotos se quedan en la carpeta original del bucket:
      mover evidencia en producción por un tema de nombre no vale el riesgo. La
      corrección queda registrada con tu nombre y la fecha.</p>
    </div>`;

  const q = document.getElementById("q-" + id) as HTMLInputElement;
  q.addEventListener("input", () => void buscar(v, btn));
  q.focus();
  void buscar(v, btn);
}

async function buscar(v: VisitaHistorial, btn: HTMLButtonElement) {
  const lista = document.getElementById("l-" + v.id);
  const q = document.getElementById("q-" + v.id) as HTMLInputElement | null;
  if (!lista || !q) return;

  let tiendas: Tienda[];
  try {
    // El catálogo del cliente se descarga una vez y se cachea (ver catalogo.ts),
    // así que a partir de la segunda letra la búsqueda es local e instantánea.
    tiendas = await buscarTiendas(v.cliente_id, q.value, 12, estado.admin ?? undefined);
  } catch {
    lista.innerHTML = `<p class="bs-hint" style="margin-left:0;color:#C4462B">
      No se pudo leer el catálogo de tiendas. Revisa la señal.</p>`;
    return;
  }

  const otras = tiendas.filter((t) => t.id !== v.tienda_id);
  if (otras.length === 0) {
    lista.innerHTML = `<p class="bs-hint" style="margin-left:0">Ninguna otra sucursal
      coincide con esa búsqueda.</p>`;
    return;
  }

  lista.innerHTML = otras
    .map(
      (t) => `<button class="bs-mini bs-corr-op" data-t="${esc(t.id)}">
        <strong>${esc(t.clave_sucursal)}</strong> ${esc(t.nombre ?? "")}
        ${t.cadena_nombre ? `<span class="bs-corr-cad">${esc(t.cadena_nombre)}</span>` : ""}
      </button>`
    )
    .join("");

  lista.querySelectorAll<HTMLButtonElement>("[data-t]").forEach((b) => {
    b.addEventListener("click", () => {
      const destino = otras.find((t) => t.id === b.dataset.t);
      if (destino) confirmar(v, destino, btn);
    });
  });
}

function confirmar(v: VisitaHistorial, destino: Tienda, btn: HTMLButtonElement) {
  const lista = document.getElementById("l-" + v.id);
  if (!lista) return;

  lista.innerHTML = `
    <div class="bs-corr-conf">
      <p class="bs-corr-mov">
        <span>${esc(v.tienda_clave)} ${esc(v.tienda_nombre ?? "")}</span>
        <span class="bs-corr-fl">↓</span>
        <span><strong>${esc(destino.clave_sucursal)} ${esc(
    destino.nombre ?? ""
  )}</strong></span>
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="bs-mini is-principal" id="ok-${esc(v.id)}">Confirmar cambio</button>
        <button class="bs-mini" id="no-${esc(v.id)}">Elegir otra</button>
      </div>
    </div>`;

  document
    .getElementById("no-" + v.id)!
    .addEventListener("click", () => void buscar(v, btn));
  document
    .getElementById("ok-" + v.id)!
    .addEventListener("click", (e) =>
      void aplicar(v, destino, e.currentTarget as HTMLButtonElement)
    );
}

async function aplicar(v: VisitaHistorial, destino: Tienda, ok: HTMLButtonElement) {
  const motivo = (document.getElementById("m-" + v.id) as HTMLInputElement | null)?.value;
  ok.disabled = true;
  ok.textContent = "Guardando…";

  const r = await corregirTienda(
    comoCorregible(v),
    destino,
    estado.admin?.nombre ?? "admin",
    motivo
  );

  if (!r.ok) {
    ok.disabled = false;
    ok.textContent = "Confirmar cambio";
    const lista = document.getElementById("l-" + v.id);
    if (lista) {
      const p = document.createElement("p");
      p.className = "bs-hint";
      p.style.cssText = "margin-left:0;color:#C4462B";
      p.textContent = r.motivo; // viene del servidor: textContent, no innerHTML
      lista.appendChild(p);
    }
    return;
  }

  // Se actualiza en memoria en vez de volver a consultar: la fila ya está y una
  // consulta nueva gastaría cuota para traer lo que acabamos de escribir.
  v.tienda_id = destino.id;
  v.cadena_id = destino.cadena_id;
  v.tienda_clave = destino.clave_sucursal;
  v.tienda_nombre = destino.nombre;
  if (destino.cadena_nombre) v.cadena_nombre = destino.cadena_nombre;
  v.datos = {
    ...v.datos,
    _correcciones: [...historialDeCorrecciones(v.datos), r.correccion],
  };

  renderResultados(); // repinta con la marca de "tienda corregida"
  avisar(`Movida a ${destino.clave_sucursal} ${destino.nombre ?? ""}`.trim());
}

function avisar(texto: string) {
  const t = document.getElementById("panel-toast");
  if (!t) return;
  t.textContent = texto;
  t.classList.add("is-on");
  window.setTimeout(() => t.classList.remove("is-on"), 3200);
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
