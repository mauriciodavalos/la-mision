// Controlador cliente del flujo de captura. Construye el formulario a partir de la
// config de la marca (config-driven, nada quemado), maneja fotos/GPS/validación,
// encola en IndexedDB y dispara la sincronización. HTML-first: la página Astro monta
// este script sobre #app.

import { comprimir, kb } from "./comprimir";
import { obtenerUbicacion, type Ubicacion } from "./gps";
import { buscarTiendas, listarMarcas, listarTiendas } from "./catalogo";
import * as cola from "./cola";
import { iniciarSync, sincronizar } from "./sync";
import { asegurarIdentidad, type Contexto } from "./identidad-ui";
import { olvidarIdentidad } from "./identidad";
import type { Agente, Cliente, FotoLocal, Marca, Tienda, VisitaPendiente } from "./tipos";

// ---- estado ----
const estado = {
  marcas: [] as Marca[],
  cliente: null as Cliente | null,
  marca: null as Marca | null,
  agente: null as Agente | null,
  vista: "captura" as "captura" | "registros",
  tienda: null as Tienda | null,
  fotos: {} as Record<string, FotoLocal>,       // por tipo de slot
  previews: {} as Record<string, string>,        // objectURLs por tipo (para revocar)
  datos: {} as Record<string, unknown>,          // campos + checklist
  notas: "",
  gps: null as Ubicacion | null,
  cargandoFoto: {} as Record<string, boolean>,
};

let regUrls: string[] = []; // objectURLs de la vista Registros (para revocar)

// ---- helpers ----
const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T | null;

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

function horaAhora(): string {
  return new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

// ---- esqueleto ----
function montarEsqueleto(root: HTMLElement) {
  root.innerHTML = `
    <header class="bs-head">
      <div class="bs-shell" style="padding-bottom:0" id="shell-head">
        <div class="bs-head-top">
          <div>
            <p class="bs-brand" id="marca-nombre">La Misión</p>
            <h1 class="bs-title">Control de<br>exhibición</h1>
            <p class="bs-quien">
              <span id="quien-txt"></span>
              <button class="bs-quien-btn" id="btn-cambiar-agente">cambiar</button>
            </p>
          </div>
          <span class="bs-chip is-on" id="chip">
            <span class="bs-dot is-live"></span><span id="chip-txt">En línea</span>
          </span>
        </div>
        <nav class="bs-tabs">
          <button class="bs-tab is-active" id="tab-captura">Capturar</button>
          <button class="bs-tab" id="tab-registros">Registros (<span id="tab-count">0</span>)</button>
        </nav>
      </div>
    </header>
    <div id="banner"></div>
    <main class="bs-shell" id="vista-captura"><div class="bs-body" id="form-body"></div></main>
    <main class="bs-shell is-wide" id="vista-registros" hidden><div class="bs-body" id="registros-body"></div></main>
    <div class="bs-queue">
      <div class="bs-queue-in">
        <div class="bs-queue-l">
          <span class="bs-queue-n is-clear" id="queue-n">00</span>
          <span class="bs-queue-t">Pendientes de subir<span class="bs-queue-s" id="queue-sub">Todo sincronizado</span></span>
        </div>
        <button class="bs-toggle" id="btn-sync">Sincronizar ahora</button>
      </div>
    </div>
  `;

  $("#tab-captura")!.addEventListener("click", () => cambiarVista("captura"));
  $("#tab-registros")!.addEventListener("click", () => cambiarVista("registros"));
  $("#btn-sync")!.addEventListener("click", () => void sincronizar());
  $("#btn-cambiar-agente")!.addEventListener("click", () => void cambiarAgente());
}

// Cierra la sesión del agente en este teléfono y vuelve a pedir PIN.
// La cola de visitas NO se toca: si hay evidencia sin subir, no se cambia de
// agente (regla no negociable: nunca perder evidencia).
async function cambiarAgente() {
  const pendientes = (await cola.listar()).filter(
    (v) => v.estado === "pendiente" || v.estado === "error"
  ).length;
  if (pendientes > 0) {
    mostrarBanner(
      `No se puede cambiar de agente: hay ${pendientes} registro(s) sin subir. ` +
        `Conéctate y sincroniza primero.`
    );
    return;
  }
  if (!confirm("¿Cambiar de agente? Se pedirá el PIN de nuevo.")) return;
  await olvidarIdentidad();
  location.reload();
}

function cambiarVista(v: "captura" | "registros") {
  estado.vista = v;
  $("#tab-captura")!.classList.toggle("is-active", v === "captura");
  $("#tab-registros")!.classList.toggle("is-active", v === "registros");
  $("#shell-head")!.classList.toggle("is-wide", v === "registros");
  $("#vista-captura")!.hidden = v !== "captura";
  $("#vista-registros")!.hidden = v !== "registros";
  if (v === "registros") void refrescarRegistros();
}

// ---- online / offline ----
function refrescarChip() {
  const on = navigator.onLine;
  const chip = $("#chip")!;
  chip.className = "bs-chip " + (on ? "is-on" : "is-off");
  chip.querySelector(".bs-dot")!.className = "bs-dot" + (on ? " is-live" : "");
  $("#chip-txt")!.textContent = on ? "En línea" : "Sin señal";
}

// ---- contexto (cliente / marca / agente) ----
// El cliente y el agente ya vienen resueltos y verificados por la pantalla de
// identidad (identidad-ui.ts). Aquí solo se cargan marca y tiendas.
async function cargarContexto(ctx: Contexto) {
  estado.cliente = ctx.cliente;
  estado.agente = ctx.agente;

  // Quién captura y en qué cuenta: siempre visible, para que nadie capture en el
  // cliente equivocado sin darse cuenta.
  $("#quien-txt")!.textContent = `${ctx.agente.nombre} · ${ctx.cliente.nombre}`;

  try {
    estado.marcas = await listarMarcas(ctx.cliente.id);
  } catch {
    mostrarBanner(
      "No se pudo leer el catálogo y no hay copia en este dispositivo. Conéctate una vez."
    );
    return;
  }
  estado.marca = estado.marcas[0] ?? null;

  if (!estado.marca) {
    mostrarBanner("Este cliente no tiene marcas configuradas.");
    return;
  }
  $("#marca-nombre")!.textContent = estado.marca.nombre;

  // Descarga el catálogo de tiendas de una vez y lo cachea: la búsqueda queda
  // instantánea y sigue funcionando dentro de la tienda sin señal.
  try {
    await listarTiendas(ctx.cliente.id);
  } catch {
    mostrarBanner(
      "Sin catálogo de tiendas descargado. Conéctate una vez para poder capturar sin señal."
    );
  }

  renderFormulario();
}

function mostrarBanner(msg: string) {
  $("#banner")!.innerHTML = `<div class="bs-banner">${esc(msg)}</div>`;
}

// ---- formulario (config-driven) ----
function renderFormulario() {
  const body = $("#form-body")!;
  const config = estado.marca!.config_captura || { fotos: [], campos: [], checklist: [] };
  const fotos = config.fotos ?? [];
  const campos = config.campos ?? [];
  const checklist = config.checklist ?? [];

  let n = 0;
  const num = () => String(++n).padStart(2, "0");
  const partes: string[] = [];

  // Selectores de contexto solo si hay más de una opción (fase 1: normalmente 1).
  if (estado.marcas.length > 1) {
    partes.push(selectorHTML("sel-marca", "Marca", estado.marcas.map((m) => [m.id, m.nombre]), estado.marca!.id));
  }
  // El agente NO se elige aquí: queda fijo por la pantalla de identidad (PIN).

  // 01 Tienda
  partes.push(`
    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">${num()}</span>
        <h2 class="bs-label">Tienda <span class="bs-req">*</span></h2></div>
      <div class="bs-inner" id="bloque-tienda"></div>
    </section>`);

  // Fotos (de la config de la marca)
  for (const f of fotos) {
    partes.push(`
      <section class="bs-field" data-foto="${esc(f.tipo)}">
        <div class="bs-legend"><span class="bs-num">${num()}</span>
          <h2 class="bs-label">${esc(f.etiqueta)} ${f.obligatoria ? '<span class="bs-req">*</span>' : ""}</h2></div>
        ${f.ayuda ? `<p class="bs-hint">${esc(f.ayuda)}</p>` : ""}
        <div class="bs-inner" id="slot-${esc(f.tipo)}"></div>
      </section>`);
  }

  // Ubicación
  partes.push(`
    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">${num()}</span><h2 class="bs-label">Ubicación</h2></div>
      <p class="bs-hint">Se toma sola del GPS del teléfono. No se escribe a mano.</p>
      <div class="bs-inner"><div class="bs-gps" id="bloque-gps"></div></div>
    </section>`);

  // Campos extra
  if (campos.length) {
    partes.push(`
      <section class="bs-field">
        <div class="bs-legend"><span class="bs-num">${num()}</span><h2 class="bs-label">Datos</h2></div>
        <div class="bs-inner" id="bloque-campos"></div>
      </section>`);
  }

  // Checklist
  if (checklist.length) {
    partes.push(`
      <section class="bs-field">
        <div class="bs-legend"><span class="bs-num">${num()}</span><h2 class="bs-label">Checklist</h2></div>
        <div class="bs-inner" id="bloque-checklist"></div>
      </section>`);
  }

  // Notas
  partes.push(`
    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">${num()}</span><h2 class="bs-label">Notas</h2></div>
      <p class="bs-hint">Opcional. Faltantes, material dañado, cambios de acomodo.</p>
      <div class="bs-inner">
        <textarea class="bs-area" id="notas" placeholder="Ej. Falta producto, sin espacio en el exhibidor…"></textarea>
      </div>
    </section>`);

  partes.push(`
    <button class="bs-submit" id="btn-guardar" disabled>Guardar registro</button>
    <p class="bs-missing" id="msg-faltan"></p>`);

  body.innerHTML = partes.join("");

  // Wiring
  if (estado.marcas.length > 1) {
    $("#sel-marca")!.addEventListener("change", (e) => {
      const id = (e.target as HTMLSelectElement).value;
      estado.marca = estado.marcas.find((m) => m.id === id) ?? estado.marca;
      $("#marca-nombre")!.textContent = estado.marca!.nombre;
      limpiarFormulario();
      renderFormulario();
    });
  }
  $("#notas")!.addEventListener("input", (e) => {
    estado.notas = (e.target as HTMLTextAreaElement).value;
  });

  for (const f of fotos) montarSlot(f.tipo, !!f.ancha, f.etiqueta);
  for (const c of campos) montarCampo(c);
  for (const it of checklist) montarChecklistItem(it);
  $("#btn-guardar")!.addEventListener("click", guardar);

  renderTienda();
  renderGps();
  actualizarValidacion();
  void refrescarGps();
}

function selectorHTML(id: string, etiqueta: string, opciones: [string, string][], sel: string): string {
  const opts = opciones
    .map(([v, t]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(t)}</option>`)
    .join("");
  return `
    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">··</span><h2 class="bs-label">${esc(etiqueta)}</h2></div>
      <div class="bs-inner"><select class="bs-select" id="${id}">${opts}</select></div>
    </section>`;
}

// ---- tienda ----
let debounceTienda: number | undefined;
function renderTienda() {
  const cont = $("#bloque-tienda");
  if (!cont) return;
  if (estado.tienda) {
    const t = estado.tienda;
    cont.innerHTML = `
      <div class="bs-picked">
        <div>
          <div class="bs-picked-name">${esc(t.nombre ?? "(sin nombre)")}</div>
          <div class="bs-picked-meta">No. ${esc(t.clave_sucursal)}${t.cadena_nombre ? " · " + esc(t.cadena_nombre) : ""}</div>
        </div>
        <button class="bs-clear" id="btn-cambiar-tienda">Cambiar</button>
      </div>`;
    $("#btn-cambiar-tienda")!.addEventListener("click", () => {
      estado.tienda = null;
      renderTienda();
      actualizarValidacion();
    });
  } else {
    cont.innerHTML = `
      <input class="bs-input" id="buscar-tienda" placeholder="Buscar por nombre o clave…" aria-label="Buscar tienda" autocomplete="off">
      <div class="bs-results" id="resultados-tienda"></div>`;
    const input = $("#buscar-tienda") as HTMLInputElement;
    input.addEventListener("input", () => {
      window.clearTimeout(debounceTienda);
      debounceTienda = window.setTimeout(() => buscarYRender(input.value), 250);
    });
    void buscarYRender("");
  }
}

async function buscarYRender(texto: string) {
  const cont = $("#resultados-tienda");
  if (!cont || !estado.cliente) return;
  try {
    const tiendas = await buscarTiendas(estado.cliente.id, texto);
    if (tiendas.length === 0) {
      cont.innerHTML = `<div style="padding:14px 12px;font-size:13px;color:#5C6660">Sin coincidencias. Revisa la clave de tienda.</div>`;
      return;
    }
    cont.innerHTML = tiendas
      .map(
        (t) => `<button class="bs-result" data-id="${esc(t.id)}">
          <div>${esc(t.nombre ?? "(sin nombre)")}</div>
          <div class="bs-result-n">No. ${esc(t.clave_sucursal)}${t.cadena_nombre ? " · " + esc(t.cadena_nombre) : ""}</div>
        </button>`
      )
      .join("");
    cont.querySelectorAll<HTMLButtonElement>(".bs-result").forEach((btn) => {
      btn.addEventListener("click", () => {
        estado.tienda = tiendas.find((t) => t.id === btn.dataset.id) ?? null;
        renderTienda();
        actualizarValidacion();
      });
    });
  } catch {
    cont.innerHTML = `<div style="padding:14px 12px;font-size:13px;color:#C4462B">No se pudieron cargar las tiendas (sin señal).</div>`;
  }
}

// ---- fotos ----
function montarSlot(tipo: string, ancha: boolean, etiqueta: string) {
  const cont = $("#slot-" + CSS.escape(tipo));
  if (!cont) return;
  renderSlot(tipo, ancha, etiqueta);
}

function renderSlot(tipo: string, ancha: boolean, etiqueta: string) {
  const cont = document.getElementById("slot-" + tipo);
  if (!cont) return;
  const foto = estado.fotos[tipo];
  const cargando = estado.cargandoFoto[tipo];
  const clase = "bs-slot" + (foto ? " is-filled" : "") + (ancha ? " is-wide-shot" : "");

  cont.innerHTML = `
    <div style="position:relative">
      <input type="file" accept="image/*" capture="environment" class="bs-hidden-input" id="input-${esc(tipo)}">
      <button type="button" class="${clase}" id="btn-${esc(tipo)}" aria-label="${foto ? esc(etiqueta) + " capturada" : "Tomar " + esc(etiqueta)}">
        ${
          foto
            ? `<img src="${estado.previews[tipo]}" alt="${esc(etiqueta)}">`
            : `<span class="bs-slot-icon" aria-hidden="true">[ + ]</span>
               <span class="bs-slot-cta">Tomar foto</span>`
        }
        ${cargando ? `<span class="bs-working"><span class="bs-spin"></span>Optimizando a WebP</span>` : ""}
      </button>
      ${
        foto && !cargando
          ? `<span class="bs-badge">${kb(foto.bytesOriginal)} → ${kb(foto.bytes)} · ${foto.ancho}×${foto.alto}</span>
             <button type="button" class="bs-retake" id="retake-${esc(tipo)}">Repetir</button>`
          : ""
      }
    </div>`;

  const input = document.getElementById("input-" + tipo) as HTMLInputElement;
  const btn = document.getElementById("btn-" + tipo)!;
  btn.addEventListener("click", () => {
    if (!estado.fotos[tipo] && !estado.cargandoFoto[tipo]) input.click();
  });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    estado.cargandoFoto[tipo] = true;
    renderSlot(tipo, ancha, etiqueta);
    try {
      const c = await comprimir(file);
      // Revoca preview anterior si lo hubiera.
      if (estado.previews[tipo]) URL.revokeObjectURL(estado.previews[tipo]);
      estado.fotos[tipo] = {
        id: crypto.randomUUID(),
        tipo,
        blob: c.blob,
        ancho: c.ancho,
        alto: c.alto,
        bytes: c.bytes,
        bytesOriginal: c.bytesOriginal,
      };
      estado.previews[tipo] = URL.createObjectURL(c.blob);
    } catch {
      delete estado.fotos[tipo];
    } finally {
      estado.cargandoFoto[tipo] = false;
      renderSlot(tipo, ancha, etiqueta);
      actualizarValidacion();
    }
  });
  const retake = document.getElementById("retake-" + tipo);
  retake?.addEventListener("click", () => {
    if (estado.previews[tipo]) URL.revokeObjectURL(estado.previews[tipo]);
    delete estado.fotos[tipo];
    delete estado.previews[tipo];
    renderSlot(tipo, ancha, etiqueta);
    actualizarValidacion();
  });
}

// ---- campos / checklist ----
function montarCampo(c: { clave: string; etiqueta: string; tipo: string; opciones?: string[] }) {
  const cont = $("#bloque-campos");
  if (!cont) return;
  const wrap = document.createElement("div");
  wrap.className = "bs-campo";
  const id = "campo-" + c.clave;
  if (c.tipo === "seleccion") {
    const opts = (c.opciones ?? []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
    wrap.innerHTML = `<p class="bs-campo-l">${esc(c.etiqueta)}</p><select class="bs-select" id="${id}"><option value="">—</option>${opts}</select>`;
  } else {
    const tipoInput = c.tipo === "numero" ? "number" : "text";
    wrap.innerHTML = `<p class="bs-campo-l">${esc(c.etiqueta)}</p><input class="bs-input" type="${tipoInput}" id="${id}">`;
  }
  cont.appendChild(wrap);
  wrap.querySelector<HTMLElement>("#" + CSS.escape(id))!.addEventListener("input", (e) => {
    estado.datos[c.clave] = (e.target as HTMLInputElement | HTMLSelectElement).value;
    actualizarValidacion();
  });
}

function montarChecklistItem(it: { clave: string; etiqueta: string }) {
  const cont = $("#bloque-checklist");
  if (!cont) return;
  const id = "chk-" + it.clave;
  const row = document.createElement("div");
  row.className = "bs-check";
  row.innerHTML = `<input type="checkbox" id="${id}"><label for="${id}">${esc(it.etiqueta)}</label>`;
  cont.appendChild(row);
  row.querySelector("input")!.addEventListener("change", (e) => {
    estado.datos[it.clave] = (e.target as HTMLInputElement).checked;
  });
}

// ---- gps ----
async function refrescarGps() {
  estado.gps = await obtenerUbicacion();
  renderGps();
}

function renderGps() {
  const cont = $("#bloque-gps");
  if (!cont) return;
  const g = estado.gps;
  const v = (x: string, muted = false) => `<div class="bs-gps-v${muted ? " is-muted" : ""}">${x}</div>`;
  cont.innerHTML = `
    <div class="bs-gps-grid">
      <div><div class="bs-gps-k">Latitud</div>${v(g ? g.lat.toFixed(5) : "buscando…", !g)}</div>
      <div><div class="bs-gps-k">Longitud</div>${v(g ? g.lng.toFixed(5) : "buscando…", !g)}</div>
      <div><div class="bs-gps-k">Precisión</div>${v(g ? "± " + g.precision + " m" : "—", !g)}</div>
      <div><div class="bs-gps-k">Hora de captura</div>${v(horaAhora())}</div>
    </div>`;
}

// ---- validación ----
function faltantes(): string[] {
  const f: string[] = [];
  if (!estado.tienda) f.push("tienda");
  const fotos = estado.marca?.config_captura?.fotos ?? [];
  for (const s of fotos) if (s.obligatoria && !estado.fotos[s.tipo]) f.push(s.etiqueta.toLowerCase());
  const campos = estado.marca?.config_captura?.campos ?? [];
  for (const c of campos) if (c.obligatorio && !estado.datos[c.clave]) f.push(c.etiqueta.toLowerCase());
  if (!estado.agente) f.push("agente");
  return f;
}

function actualizarValidacion() {
  const f = faltantes();
  const btn = $("#btn-guardar") as HTMLButtonElement | null;
  const msg = $("#msg-faltan");
  if (!btn || !msg) return;
  btn.disabled = f.length > 0;
  if (f.length > 0) {
    msg.style.color = "";
    msg.textContent = "Falta " + f.join(" · ");
  } else {
    msg.style.color = "#5C6660";
    msg.textContent = navigator.onLine
      ? "Se sube en cuanto lo guardes."
      : "Se guarda en el teléfono y se sube solo cuando haya señal.";
  }
}

// ---- guardar ----
async function guardar() {
  if (faltantes().length > 0) return;
  const m = estado.marca!;
  const t = estado.tienda!;
  const ahora = new Date().toISOString();

  const visita: VisitaPendiente = {
    id: crypto.randomUUID(),
    cliente_id: estado.cliente!.id,
    marca_id: m.id,
    cadena_id: t.cadena_id,
    tienda_id: t.id,
    agente_id: estado.agente!.id,
    capturada_en: ahora,
    latitud: estado.gps?.lat ?? null,
    longitud: estado.gps?.lng ?? null,
    precision_gps: estado.gps?.precision ?? null,
    datos: { ...estado.datos },
    notas: estado.notas.trim(),
    fotos: Object.values(estado.fotos),
    tienda_nombre: t.nombre ?? "(sin nombre)",
    tienda_clave: t.clave_sucursal,
    // Se copian al encolar para que la ruta del Storage se pueda armar sin red
    // al momento de subir (ver sync.ts -> rutaFoto).
    cliente_slug: estado.cliente!.slug,
    cadena_slug: t.cadena_slug,
    estado: "pendiente",
    creada_en: ahora,
  };

  await cola.guardar(visita);
  limpiarFormulario();
  renderFormulario();
  await refrescarQueue();
  void sincronizar(); // intenta subir ya si hay señal
}

function limpiarFormulario() {
  // No revocamos los previews: ahora pertenecen a la visita encolada (se muestran
  // en Registros desde el blob). Solo soltamos las referencias del formulario.
  estado.tienda = null;
  estado.fotos = {};
  estado.previews = {};
  estado.datos = {};
  estado.notas = "";
  estado.cargandoFoto = {};
}

// ---- registros ----
async function refrescarRegistros() {
  const cont = $("#registros-body");
  if (!cont) return;
  // Revoca URLs del render anterior.
  regUrls.forEach((u) => URL.revokeObjectURL(u));
  regUrls = [];

  const visitas = await cola.listar();
  const total = visitas.length;
  const sinc = visitas.filter((v) => v.estado === "sincronizado").length;
  const pend = visitas.filter((v) => v.estado === "pendiente" || v.estado === "error").length;

  const stats = `
    <div class="bs-stats">
      <div class="bs-stat"><div class="bs-stat-n">${total}</div><div class="bs-stat-k">Capturados</div></div>
      <div class="bs-stat"><div class="bs-stat-n">${sinc}</div><div class="bs-stat-k">En servidor</div></div>
      <div class="bs-stat"><div class="bs-stat-n" style="${pend ? "color:#C4462B" : ""}">${pend}</div><div class="bs-stat-k">En cola</div></div>
    </div>`;

  if (total === 0) {
    cont.innerHTML =
      stats +
      `<div class="bs-empty"><p class="bs-empty-h">Todavía no hay registros</p>
       <p class="bs-empty-p">Captura una exhibición y aparecerá aquí con sus fotos, ubicación y hora real.</p></div>`;
    return;
  }

  const filas = visitas
    .map((v) => {
      const thumbs = v.fotos
        .slice(0, 2)
        .map((f) => {
          const u = URL.createObjectURL(f.blob);
          regUrls.push(u);
          return `<img class="bs-thumb" src="${u}" alt="${esc(f.tipo)}">`;
        })
        .join("");
      const totBytes = v.fotos.reduce((s, f) => s + f.bytes, 0);
      const gps = v.latitud != null ? `${v.latitud.toFixed(4)}, ${v.longitud!.toFixed(4)}` : "sin gps";
      const estadoClase = v.estado === "sincronizado" ? "is-sync" : v.estado === "error" ? "is-error" : "is-pend";
      const estadoTxt = v.estado === "sincronizado" ? "En servidor" : v.estado === "error" ? "Reintentando" : "En cola";
      return `
        <article class="bs-row">
          <div class="bs-thumbs">${thumbs}</div>
          <div>
            <div class="bs-row-name">${esc(v.tienda_nombre)}</div>
            <div class="bs-row-meta">No. ${esc(v.tienda_clave)} · ${fmtFechaHora(v.capturada_en)}<br>${gps} · ${kb(totBytes)}</div>
            ${v.notas ? `<div class="bs-row-meta" style="color:#14181B">“${esc(v.notas)}”</div>` : ""}
            ${v.estado === "error" && v.ultimo_error ? `<div class="bs-row-meta" style="color:#C4462B">${esc(v.ultimo_error)}</div>` : ""}
          </div>
          <span class="bs-state ${estadoClase}">${estadoTxt}</span>
        </article>`;
    })
    .join("");

  cont.innerHTML =
    stats +
    `<div class="bs-rows">${filas}</div>
     <p class="bs-note">Cada registro guarda la hora real de captura y la de subida por separado. Si hay diferencia entre las dos, el trabajo se hizo en tienda y se sincronizó después — no es una falla.</p>`;
}

// ---- barra de cola ----
async function refrescarQueue() {
  const visitas = await cola.listar();
  const pend = visitas.filter((v) => v.estado === "pendiente" || v.estado === "error").length;
  $("#tab-count")!.textContent = String(visitas.length);
  const n = $("#queue-n")!;
  n.textContent = String(pend).padStart(2, "0");
  n.className = "bs-queue-n" + (pend ? "" : " is-clear");
  $("#queue-sub")!.textContent =
    pend === 0 ? "Todo sincronizado" : navigator.onLine ? "Subiendo en segundo plano…" : "Guardados en el teléfono";
}

// ---- init ----
export async function init() {
  const root = document.getElementById("app");
  if (!root) return;

  // 1) Identificar al agente ANTES de montar la app. Si no se puede (sin catálogo,
  //    sin agentes), asegurarIdentidad ya dejó puesta la pantalla que lo explica.
  const ctx = await asegurarIdentidad(root);
  if (!ctx) return;

  // 2) Ya identificado: se monta el flujo de captura.
  montarEsqueleto(root);
  refrescarChip();

  window.addEventListener("online", () => {
    refrescarChip();
    actualizarValidacion();
    void refrescarQueue();
  });
  window.addEventListener("offline", () => {
    refrescarChip();
    actualizarValidacion();
    void refrescarQueue();
  });
  window.addEventListener("cola-cambio", () => {
    void refrescarQueue();
    if (estado.vista === "registros") void refrescarRegistros();
  });

  await cargarContexto(ctx);
  await refrescarQueue();
  iniciarSync();
}
