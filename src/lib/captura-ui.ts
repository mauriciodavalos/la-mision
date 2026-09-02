// Controlador cliente del flujo de captura. Construye el formulario a partir de la
// config de la marca (config-driven, nada quemado), maneja fotos/GPS/validación,
// encola en IndexedDB y dispara la sincronización. HTML-first: la página Astro monta
// este script sobre #app.

import { comprimir, kb, type Comprimida } from "./comprimir";
import { explicarCamara, soportaCamara, tomarFoto } from "./camara";
import {
  comoTexto,
  listarCaidas,
  marcar,
  murioEnLaCamara,
  olvidarCaidas,
  revisarCaida,
  VERSION_APP,
  cerrar as cerrarRastro,
  type Caida,
} from "./rastro";
import {
  estadoPermiso,
  explicar,
  explicarBreve,
  iniciarSeguimiento,
  instruccionesPermiso,
  obtenerUbicacion,
  type MotivoGps,
  type Ubicacion,
} from "./gps";
import { abrirModal, type Modal } from "./modal";
import { asegurarPersistencia, espacio } from "./almacen";
import {
  decidirAviso,
  LIMITE_ESPERA_MS,
  textoOtrasSubidas,
  textoPendientesAlSalir,
  type Espera,
} from "./avisos";
import type { DetalleCola } from "./sync";
import { buscarTiendas, listarMarcas, listarTiendas } from "./catalogo";
import * as cola from "./cola";
import { iniciarSync, sincronizar } from "./sync";
import { asegurarIdentidad, type Contexto } from "./identidad-ui";
import { olvidarIdentidad } from "./identidad";
import {
  DIAS_CONSERVAR_REGISTRO,
  HORAS_CONSERVAR_FOTOS,
  purgarSilencioso,
} from "./retencion";
import {
  fotosDeVisita,
  hoyLocal,
  hoyMenosDias,
  listarVisitas,
} from "./historial";
import type { Agente, Borrador, Cliente, FotoLocal, Marca, Tienda, VisitaPendiente } from "./tipos";

// ---- estado ----
type Vista = "captura" | "registros" | "historial";

const estado = {
  marcas: [] as Marca[],
  cliente: null as Cliente | null,
  marca: null as Marca | null,
  agente: null as Agente | null,
  vista: "captura" as Vista,
  tienda: null as Tienda | null,
  fotos: {} as Record<string, FotoLocal>,       // por tipo de slot
  previews: {} as Record<string, string>,        // objectURLs por tipo (para revocar)
  datos: {} as Record<string, unknown>,          // campos + checklist
  notas: "",
  gps: null as Ubicacion | null,
  gpsMotivo: null as MotivoGps | null,      // por qué no hay ubicación
  gpsBuscando: false,
  cargandoFoto: {} as Record<string, boolean>,
  erroresFoto: {} as Record<string, string>, // por qué falló una foto, por slot
};

let regUrls: string[] = []; // objectURLs de la vista Registros (para revocar)

// Seguimiento de GPS vivo mientras dura la captura (ver arrancarSeguimientoGps).
let detenerGps: (() => void) | null = null;
// Guardado del borrador con retardo, para no escribir en IndexedDB en cada tecla.
let debounceBorrador: number | undefined;

// ---- confirmación de subida ----
// Qué visita está esperando confirmación del servidor, con su popup abierto.
// Ver avisos.ts para la regla de cuándo interrumpir y cuándo no.
let espera: Espera | null = null;
let modalEspera: Modal | null = null;
let relojEspera: number | undefined;

// El aviso de permiso de ubicación sale solo UNA vez por captura: es el único
// motivo de GPS que no se arregla esperando, pero repetirlo cada vez que el
// watch falla lo volvería ruido.
let avisoPermisoDado = false;

// ---- modo de cámara ----
//
// Por omisión se usa la cámara del sistema (`<input capture>`), que da la mejor
// foto. En los teléfonos donde salir de la app mata la pestaña por memoria, se
// usa la cámara dentro de la app (camara.ts). Es por dispositivo, no por agente:
// el problema es del teléfono.
const LLAVE_MODO_CAMARA = "lamision.camara-en-app";

function camaraEnApp(): boolean {
  try {
    return localStorage.getItem(LLAVE_MODO_CAMARA) === "1" && soportaCamara();
  } catch {
    return false;
  }
}

function ponerCamaraEnApp(v: boolean): void {
  try {
    localStorage.setItem(LLAVE_MODO_CAMARA, v ? "1" : "0");
  } catch {
    /* sin localStorage: se queda con el modo normal */
  }
}

// Arriba de esta precisión se avisa, pero NO se bloquea: una lectura de ±300 m
// sigue diciendo en qué plaza está el agente, y exigir precisión fina dentro de
// una tienda es exigir lo que el teléfono no puede dar.
const PRECISION_AVISO = 100;

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
              <span class="bs-admin" id="chip-admin" hidden>admin</span>
              <a class="bs-quien-btn" id="link-panel" href="/admin/reportes"
                 style="text-decoration:none" hidden>panel</a>
              <button class="bs-quien-btn" id="btn-cambiar-agente">cambiar</button>
              <span class="bs-ver">${VERSION_APP}</span>
            </p>
          </div>
          <span class="bs-chip is-on" id="chip">
            <span class="bs-dot is-live"></span><span id="chip-txt">En línea</span>
          </span>
        </div>
        <nav class="bs-tabs">
          <button class="bs-tab is-active" id="tab-captura">Capturar</button>
          <button class="bs-tab" id="tab-registros">En el equipo (<span id="tab-count">0</span>)</button>
          <button class="bs-tab" id="tab-historial">Historial</button>
        </nav>
      </div>
    </header>
    <div id="banner"></div>
    <main class="bs-shell" id="vista-captura"><div class="bs-body" id="form-body"></div></main>
    <main class="bs-shell is-wide" id="vista-registros" hidden><div class="bs-body" id="registros-body"></div></main>
    <main class="bs-shell is-wide" id="vista-historial" hidden><div class="bs-body" id="historial-body"></div></main>
    <div class="bs-toast" id="toast" role="status" aria-live="polite"></div>
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
  $("#tab-historial")!.addEventListener("click", () => cambiarVista("historial"));
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
  detenerGps?.();
  detenerGps = null;
  await olvidarIdentidad();
  location.reload();
}

function cambiarVista(v: Vista) {
  estado.vista = v;
  $("#tab-captura")!.classList.toggle("is-active", v === "captura");
  $("#tab-registros")!.classList.toggle("is-active", v === "registros");
  $("#tab-historial")!.classList.toggle("is-active", v === "historial");
  $("#shell-head")!.classList.toggle("is-wide", v !== "captura");
  $("#vista-captura")!.hidden = v !== "captura";
  $("#vista-registros")!.hidden = v !== "registros";
  $("#vista-historial")!.hidden = v !== "historial";
  if (v === "registros") void refrescarRegistros();
  if (v === "historial") montarHistorial();
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

  actualizarQuien();

  try {
    // Solo las marcas que el agente tiene asignadas (todas, si es admin).
    estado.marcas = await listarMarcas(ctx.cliente.id, ctx.agente);
  } catch {
    mostrarBanner(
      "No se pudo leer el catálogo y no hay copia en este dispositivo. Conéctate una vez."
    );
    return;
  }

  if (estado.marcas.length === 0) {
    mostrarBanner(
      ctx.agente.es_admin
        ? "Este cliente no tiene marcas configuradas."
        : "No tienes marcas asignadas en este cliente. Pide que te asignen una para poder capturar."
    );
    return;
  }

  // Con UNA marca asignada se elige sola. Con varias NO se adivina: el agente
  // tiene que elegir. Tomar la primera por orden alfabético haría que capturara
  // siempre en la misma marca sin darse cuenta, y la evidencia quedaría mal
  // atribuida hasta que alguien lo notara en el reporte — o nunca.
  estado.marca = estado.marcas.length === 1 ? estado.marcas[0] : null;
  actualizarQuien();

  await precargarTiendas();
  renderFormulario();
}

// Descarga y cachea las tiendas de la marca elegida: la búsqueda queda instantánea
// y sigue funcionando dentro de la tienda sin señal.
async function precargarTiendas() {
  if (!estado.cliente || !estado.marca) return;
  try {
    await listarTiendas(estado.cliente.id, estado.agente ?? undefined, estado.marca.id);
  } catch {
    mostrarBanner(
      "Sin catálogo de tiendas descargado. Conéctate una vez para poder capturar sin señal."
    );
  }
}

// Quién captura, en qué cuenta y con qué marca. Siempre visible, para que nadie
// capture en el cliente o la marca equivocada sin darse cuenta.
function actualizarQuien() {
  const partes = [estado.agente?.nombre ?? "", estado.cliente?.nombre ?? ""];
  if (estado.marca) partes.push(estado.marca.nombre);
  $("#quien-txt")!.textContent = partes.filter(Boolean).join(" · ");
  const marcaEnc = $("#marca-nombre");
  if (marcaEnc) {
    marcaEnc.textContent = estado.marca?.nombre ?? estado.cliente?.nombre ?? "La Misión";
  }
  const chip = $("#chip-admin");
  if (chip) chip.hidden = !estado.agente?.es_admin;
  // El panel de registros del equipo solo se le ofrece a quien puede abrirlo.
  const panel = $("#link-panel");
  if (panel) panel.hidden = !estado.agente?.es_admin;
}

function mostrarBanner(msg: string) {
  $("#banner")!.innerHTML = `<div class="bs-banner">${esc(msg)}</div>`;
}

// ---- formulario (config-driven) ----
function renderFormulario() {
  const body = $("#form-body")!;
  const config = estado.marca?.config_captura || { fotos: [], campos: [], checklist: [] };
  const fotos = estado.marca ? config.fotos ?? [] : [];
  const campos = estado.marca ? config.campos ?? [] : [];
  const checklist = estado.marca ? config.checklist ?? [] : [];

  let n = 0;
  const num = () => String(++n).padStart(2, "0");
  const partes: string[] = [];

  // Selector de marca cuando hay más de una asignada. Arranca SIN elegir: lo que
  // se captura depende de esto y no se puede adivinar.
  if (estado.marcas.length > 1) {
    partes.push(
      selectorHTML(
        "sel-marca",
        "Marca",
        [
          ["", "— elige la marca —"] as [string, string],
          ...estado.marcas.map((m) => [m.id, m.nombre] as [string, string]),
        ],
        estado.marca?.id ?? ""
      )
    );
  }
  // El agente NO se elige aquí: queda fijo por la pantalla de identidad (PIN).

  // Sin marca elegida no se dibuja el resto: qué fotos y qué campos se piden lo
  // define la config de la marca.
  if (!estado.marca) {
    partes.push(
      `<p class="bs-hint" style="margin-left:0">Elige la marca para empezar a capturar.</p>`
    );
    body.innerHTML = partes.join("");
    $("#sel-marca")!.addEventListener("change", (e) => cambiarMarca((e.target as HTMLSelectElement).value));
    return;
  }

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

  // Modo de cámara. Solo se ofrece si el navegador puede abrirla dentro de la
  // app; en el resto no tiene caso mostrar un interruptor que no hace nada.
  if (fotos.length && soportaCamara()) {
    partes.push(`
      <section class="bs-field">
        <label class="bs-check bs-camara-modo">
          <input type="checkbox" id="modo-camara" ${camaraEnApp() ? "checked" : ""}>
          <span>Tomar las fotos dentro de la app</span>
        </label>
        <p class="bs-hint">Actívalo si al tomar la foto el teléfono se reinicia o
        dice que no hay memoria: la app deja de abrir la cámara del sistema, que es
        lo que tumba la página en teléfonos con poca memoria.</p>
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
    <button class="bs-submit" id="btn-guardar">Guardar registro</button>
    <p class="bs-missing" id="msg-faltan"></p>`);

  body.innerHTML = partes.join("");

  // Wiring
  if (estado.marcas.length > 1) {
    $("#sel-marca")!.addEventListener("change", (e) =>
      cambiarMarca((e.target as HTMLSelectElement).value)
    );
  }
  $("#notas")!.addEventListener("input", (e) => {
    estado.notas = (e.target as HTMLTextAreaElement).value;
    programarBorrador();
  });

  $("#modo-camara")?.addEventListener("change", (e) => {
    ponerCamaraEnApp((e.target as HTMLInputElement).checked);
  });

  for (const f of fotos) montarSlot(f.tipo, !!f.ancha, f.etiqueta);
  for (const c of campos) montarCampo(c);
  for (const it of checklist) montarChecklistItem(it);
  $("#btn-guardar")!.addEventListener("click", guardar);

  renderTienda();
  renderGps();
  actualizarValidacion();
  void refrescarGps();
  arrancarSeguimientoGps();
}

// Cambiar de marca cambia también las cadenas —y por lo tanto las tiendas— que le
// tocan al agente, así que hay que soltar la tienda elegida y recargar el catálogo.
async function cambiarMarca(marcaId: string) {
  estado.marca = estado.marcas.find((m) => m.id === marcaId) ?? null;
  limpiarFormulario();
  actualizarQuien();
  await precargarTiendas();
  renderFormulario();
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
      void guardarBorrador();
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
    // Solo las tiendas de las cadenas asignadas al agente para esta marca.
    const tiendas = await buscarTiendas(
      estado.cliente.id,
      texto,
      20,
      estado.agente ?? undefined,
      estado.marca?.id
    );
    if (tiendas.length === 0) {
      cont.innerHTML = `<div style="padding:14px 12px;font-size:13px;color:#5C6660">Sin coincidencias entre las tiendas que tienes asignadas para esta marca.</div>`;
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
          ? `<span class="bs-badge">${
              // Con la cámara en la app no hay archivo original que comparar:
              // el cuadro ya nace del tamaño que se guarda.
              foto.bytesOriginal > foto.bytes ? kb(foto.bytesOriginal) + " → " : ""
            }${kb(foto.bytes)} · ${foto.ancho}×${foto.alto}</span>
             <button type="button" class="bs-retake" id="retake-${esc(tipo)}">Repetir</button>`
          : ""
      }
    </div>
    ${
      estado.erroresFoto[tipo]
        ? `<p class="bs-foto-error">${esc(estado.erroresFoto[tipo])}</p>`
        : ""
    }`;

  const input = document.getElementById("input-" + tipo) as HTMLInputElement;
  const btn = document.getElementById("btn-" + tipo)!;
  btn.addEventListener("click", () => {
    if (estado.fotos[tipo] || estado.cargandoFoto[tipo]) return;
    if (camaraEnApp()) {
      void desdeCamaraEnApp(tipo, ancha, etiqueta);
      return;
    }
    // ESTA marca es la que decide el diagnóstico. Si el rastro se queda aquí,
    // la pestaña murió con la app de cámara al frente y nuestro código nunca
    // llegó a correr (ver rastro.ts).
    liberarAntesDeSalir();
    marcar("camara-abierta", etiqueta);
    input.click();
  });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      // El agente canceló la cámara: el rastro se cierra para no leerse como caída.
      cerrarRastro();
      return;
    }
    marcar("archivo-recibido", `${file.size} bytes · ${file.type || "sin tipo"}`);
    await procesarFoto(tipo, ancha, etiqueta, () => comprimir(file));
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

// Antes de salir a la app de cámara, soltar lo que se pueda: el navegador queda
// en segundo plano y Android decide a quién matar por cuánta memoria ocupa. No
// garantiza nada —el recolector corre cuando quiere— pero baja la huella y no
// cuesta nada.
function liberarAntesDeSalir() {
  for (const url of regUrls) URL.revokeObjectURL(url);
  regUrls = [];
}

// Único camino de entrada de una foto, venga de la cámara del sistema o de la
// cámara dentro de la app. Todo lo de después —resguardo, preview, validación—
// es idéntico; lo único que cambia es de dónde sale el blob.
async function procesarFoto(
  tipo: string,
  ancha: boolean,
  etiqueta: string,
  obtener: () => Promise<Comprimida>
) {
  estado.cargandoFoto[tipo] = true;
  delete estado.erroresFoto[tipo];
  renderSlot(tipo, ancha, etiqueta);
  try {
    const c = await obtener();
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
    // La foto ya comprimida se resguarda de inmediato: si el navegador cierra
    // la pestaña (memoria), no se pierde el trabajo.
    void guardarBorrador();
    marcar("foto-guardada", tipo);
    // Llegó completa: el rastro se cierra para que no se lea como caída.
    cerrarRastro();
  } catch (e) {
    // Antes esto se tragaba el error y la foto simplemente no aparecía, sin
    // explicación. Ahora se dice qué pasó y se puede reintentar.
    delete estado.fotos[tipo];
    marcar("foto-error", e instanceof Error ? e.message : String(e));
    estado.erroresFoto[tipo] =
      e instanceof Error && /memor|allocat/i.test(e.message)
        ? "El teléfono se quedó sin memoria al procesar la foto. Cierra otras apps o pestañas y vuelve a intentar."
        : "No se pudo procesar la foto. Vuelve a intentar.";
  } finally {
    estado.cargandoFoto[tipo] = false;
    renderSlot(tipo, ancha, etiqueta);
    actualizarValidacion();
  }
}

// Cámara dentro de la app: el navegador nunca pasa a segundo plano, así que no
// hay nada que Android pueda matar mientras se toma la foto.
async function desdeCamaraEnApp(tipo: string, ancha: boolean, etiqueta: string) {
  const r = await tomarFoto(etiqueta);
  if (!r.ok) {
    cerrarRastro();
    if (r.motivo === "cancelada") return;
    estado.erroresFoto[tipo] = explicarCamara(r.motivo);
    // Si la cámara en la app no sirve en este teléfono, no dejarlo sin capturar:
    // se vuelve al modo normal y el agente puede tomar la foto igual.
    if (r.motivo === "sin_soporte" || r.motivo === "permiso") ponerCamaraEnApp(false);
    renderSlot(tipo, ancha, etiqueta);
    return;
  }
  await procesarFoto(tipo, ancha, etiqueta, async () => r.foto);
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
// Pide la ubicación a mano: al montar el formulario y cada vez que el agente toca
// el botón. Ese toque es además el gesto de usuario que iOS exige para volver a
// preguntar por el permiso una vez que se negó.
async function refrescarGps() {
  estado.gpsBuscando = true;
  estado.gpsMotivo = null;
  renderGps();

  const r = await obtenerUbicacion();
  estado.gpsBuscando = false;
  if (r.ok) {
    estado.gps = r.ubicacion;
    estado.gpsMotivo = null;
  } else {
    // Una lectura buena previa NO se tira porque un reintento haya fallado.
    estado.gpsMotivo = r.motivo;
  }
  renderGps();
  actualizarValidacion();
  avisarSiFaltaPermiso();
}

// El permiso bloqueado es el ÚNICO motivo de GPS que no se arregla esperando:
// no hay diálogo que vuelva a salir y el seguimiento continuo tampoco lo va a
// resolver. Descubrirlo hasta el final es perder la visita completa, así que se
// avisa en cuanto se sabe — una sola vez por captura, para no volverlo ruido.
// Los demás motivos (timeout, no disponible) se quedan en el bloque de GPS:
// ahí esperar sí sirve.
function avisarSiFaltaPermiso() {
  if (estado.gps || avisoPermisoDado) return;
  if (estado.gpsMotivo !== "permiso") return;
  avisoPermisoDado = true;
  void popupUbicacion();
}

// Seguimiento continuo mientras el agente llena el formulario: le da al GPS toda
// la visita para fijar posición, en vez de un tiro de segundos al final. Es lo
// que hace viable exigir ubicación adentro de una tienda.
function arrancarSeguimientoGps() {
  detenerGps?.();
  detenerGps = iniciarSeguimiento(
    (u) => {
      estado.gps = u;
      estado.gpsMotivo = null;
      renderGps();
      actualizarValidacion();
    },
    (m) => {
      // Solo se reporta si todavía no hay nada: un error del watch no debe
      // borrar una posición que ya se consiguió.
      if (!estado.gps) {
        estado.gpsMotivo = m;
        renderGps();
        actualizarValidacion();
        avisarSiFaltaPermiso();
      }
    }
  );
}

function renderGps() {
  const cont = $("#bloque-gps");
  if (!cont) return;
  const g = estado.gps;
  const buscando = estado.gpsBuscando;
  const v = (x: string, muted = false) => `<div class="bs-gps-v${muted ? " is-muted" : ""}">${x}</div>`;
  const vacio = buscando ? "buscando…" : "sin ubicación";

  const notas: string[] = [];
  if (g && g.precision > PRECISION_AVISO) {
    notas.push(
      `<p class="bs-gps-nota">Ubicación poco precisa (± ${g.precision} m). Se puede
       guardar así, pero si puedes acércate a la entrada y toca Actualizar.</p>`
    );
  }
  if (!g && !buscando) {
    if (estado.gpsMotivo) {
      notas.push(`<p class="bs-gps-nota is-alerta">${esc(explicar(estado.gpsMotivo))}</p>`);
    }
    notas.push(
      `<p class="bs-gps-nota">Sin ubicación no se puede guardar: una foto de
       exhibición sin coordenadas no se puede auditar.</p>`
    );
  }

  cont.innerHTML = `
    <div class="bs-gps-grid">
      <div><div class="bs-gps-k">Latitud</div>${v(g ? g.lat.toFixed(5) : vacio, !g)}</div>
      <div><div class="bs-gps-k">Longitud</div>${v(g ? g.lng.toFixed(5) : vacio, !g)}</div>
      <div><div class="bs-gps-k">Precisión</div>${v(g ? "± " + g.precision + " m" : "—", !g)}</div>
      <div><div class="bs-gps-k">Hora de captura</div>${v(horaAhora())}</div>
    </div>
    ${notas.join("")}
    <button type="button" class="bs-clear" id="btn-gps" style="margin-top:12px"${
      buscando ? " disabled" : ""
    }>${buscando ? "Buscando…" : g ? "Actualizar ubicación" : "Reintentar ubicación"}</button>`;

  $("#btn-gps")?.addEventListener("click", () => void refrescarGps());
}

// ---- validación ----
function faltantes(): string[] {
  const f: string[] = [];
  if (!estado.marca) f.push("marca");
  if (!estado.tienda) f.push("tienda");
  const fotos = estado.marca?.config_captura?.fotos ?? [];
  for (const s of fotos) if (s.obligatoria && !estado.fotos[s.tipo]) f.push(s.etiqueta.toLowerCase());
  const campos = estado.marca?.config_captura?.campos ?? [];
  for (const c of campos) if (c.obligatorio && !estado.datos[c.clave]) f.push(c.etiqueta.toLowerCase());
  // La ubicación es obligatoria: sin coordenadas la evidencia no se puede
  // auditar. Se acepta cualquier precisión (ver PRECISION_AVISO), justamente
  // para que el requisito no deje al agente sin poder capturar bajo techo.
  if (!estado.gps) f.push("ubicación");
  if (!estado.agente) f.push("agente");
  return f;
}

function actualizarValidacion() {
  const f = faltantes();
  const btn = $("#btn-guardar") as HTMLButtonElement | null;
  const msg = $("#msg-faltan");
  if (!btn || !msg) return;
  // El botón NO se deshabilita. El bloqueo sigue siendo duro —guardar() se
  // niega si falta algo— pero un botón gris con letra chica abajo es
  // exactamente lo que un agente no ve dentro de una tienda. Tocable, explica
  // qué falta y qué hacer al respecto.
  //
  // Se fuerza `disabled = false` a propósito, aunque el HTML ya no lo ponga:
  // quitar la línea que lo habilitaba sin quitar el atributo del marcado dejó
  // el botón muerto en producción (1 sep). Que quede explícito aquí.
  btn.disabled = false;
  btn.classList.toggle("is-incompleto", f.length > 0);
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

// ---- popup de ubicación ----
//
// El permiso NO se puede volver a pedir por código una vez que el agente eligió
// bloquear: el navegador contesta PERMISSION_DENIED sin mostrar diálogo y no hay
// API para revocarlo. Pero "bloqueado" y "todavía no contesta" son estados
// distintos, y estadoPermiso() los distingue. De eso depende qué botón tiene
// sentido ofrecer: uno que abra el diálogo real, o las instrucciones de Ajustes.
async function popupUbicacion() {
  const permiso = await estadoPermiso();
  const motivo = estado.gpsMotivo;

  if (permiso === "denied" || motivo === "permiso") {
    abrirModal({
      // Corto a propósito: el agente está de pie en una tienda. Lo único que
      // necesita saber es que hace falta y cómo activarla; el porqué está en el
      // aviso en línea del bloque de GPS, para quien lo quiera leer.
      titulo: "Falta la ubicación",
      cuerpo: "Se necesita para guardar el registro. Actívala así:",
      pasos: instruccionesPermiso(),
      tono: "alerta",
      acciones: [
        {
          texto: "Ya lo activé",
          principal: true,
          cierra: false,
          alTocar: async () => {
            await refrescarGps();
            arrancarSeguimientoGps();
            if (estado.gps) {
              abrirModal({
                titulo: "Ubicación lista",
                cuerpo: `Precisión de ± ${estado.gps.precision} m.`,
                tono: "exito",
                acciones: [{ texto: "Continuar", principal: true }],
              });
            } else {
              await popupUbicacion();
            }
          },
        },
        { texto: "Cerrar" },
      ],
    });
    return;
  }

  if (permiso === "prompt" || permiso === "desconocido") {
    // Aquí el diálogo del navegador SÍ puede volver a salir, pero necesita un
    // gesto del usuario: por eso va detrás de un botón y no automático.
    abrirModal({
      titulo: "Falta la ubicación",
      cuerpo: "Se necesita para guardar el registro. Toca el botón y acepta el aviso.",
      acciones: [
        {
          texto: "Permitir ubicación",
          principal: true,
          cierra: false,
          alTocar: async () => {
            await refrescarGps();
            arrancarSeguimientoGps();
            if (estado.gps) {
              abrirModal({
                titulo: "Ubicación lista",
                cuerpo: `Precisión de ± ${estado.gps.precision} m.`,
                tono: "exito",
                acciones: [{ texto: "Continuar", principal: true }],
              });
            } else {
              await popupUbicacion();
            }
          },
        },
        { texto: "Cerrar" },
      ],
    });
    return;
  }

  // Permiso concedido: no es permiso, es señal. Esperar aquí sí sirve, y el
  // seguimiento continuo suele resolverlo sin que el agente haga nada.
  abrirModal({
    titulo: "Buscando la ubicación",
    cuerpo: explicarBreve(motivo ?? "timeout"),
    nota: "La app sigue buscando sola mientras llenas el formulario.",
    acciones: [
      {
        texto: "Buscar de nuevo",
        principal: true,
        cierra: false,
        alTocar: async () => {
          await refrescarGps();
          if (estado.gps) {
            abrirModal({
              titulo: "Ubicación lista",
              cuerpo: `Precisión de ± ${estado.gps.precision} m. Ya puedes guardar el registro.`,
              tono: "exito",
              acciones: [{ texto: "Continuar", principal: true }],
            });
          }
        },
      },
      { texto: "Cerrar" },
    ],
  });
}

// ---- aviso discreto (no interrumpe la captura) ----
let relojToast: number | undefined;
function avisoDiscreto(texto: string) {
  const cont = $("#toast");
  if (!cont) return;
  cont.textContent = texto;
  cont.classList.add("is-on");
  window.clearTimeout(relojToast);
  relojToast = window.setTimeout(() => cont.classList.remove("is-on"), 4000);
}

// ---- guardar ----
async function guardar() {
  const f = faltantes();
  if (f.length > 0) {
    // El bloqueo se mantiene: no se guarda. Pero ahora se explica.
    if (f.length === 1 && f[0] === "ubicación") {
      await popupUbicacion();
    } else {
      abrirModal({
        titulo: "Falta completar",
        cuerpo: "Antes de guardar:",
        pasos: f,
        tono: "alerta",
        acciones: [
          ...(f.includes("ubicación")
            ? [{ texto: "Ver lo de la ubicación", alTocar: () => void popupUbicacion(), cierra: false }]
            : []),
          { texto: "Entendido", principal: true },
        ],
      });
    }
    return;
  }
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
  // La evidencia ya está en la cola: el borrador cumplió y se suelta.
  await cola.borrarBorrador();
  limpiarFormulario();
  renderFormulario();
  await refrescarQueue();

  esperarConfirmacion(visita.id, t.nombre ?? "la tienda");
  void sincronizar(); // intenta subir ya si hay señal
}

// Abre el popup de confirmación y se queda esperando a que el SERVIDOR confirme
// esta visita en particular (ver el detalle de `cola-cambio` en sync.ts).
//
// Antes de esto, al guardar la pantalla simplemente se vaciaba: el agente no
// tenía forma de saber si su trabajo había quedado registrado, mucho menos si
// había llegado al servidor.
function esperarConfirmacion(id: string, tienda: string) {
  espera = { id, desde: Date.now() };
  modalEspera = abrirModal({
    titulo: "Registro guardado",
    cuerpo: `${tienda} — ${navigator.onLine ? "subiendo al servidor…" : "sin señal"}`,
    nota: navigator.onLine
      ? undefined
      : "Queda guardado en el teléfono y se sube solo cuando haya señal.",
    descartable: false,
    acciones: navigator.onLine ? [] : [{ texto: "Entendido", principal: true }],
  });

  // Sin señal no hay nada que esperar: el popup ya dice lo que va a pasar.
  if (!navigator.onLine) {
    dejarDeEsperar();
    return;
  }

  window.clearTimeout(relojEspera);
  relojEspera = window.setTimeout(() => {
    // Tardó demasiado. No se deja al agente mirando una rueda: la visita está
    // encolada y se sube sola, que es lo único que necesita saber.
    modalEspera?.actualizar({
      titulo: "Guardado en el teléfono",
      cuerpo: `${tienda} — la subida está tardando. Queda en la cola y se sube solo.`,
      nota: "No hace falta esperar aquí. Puedes seguir capturando.",
      acciones: [{ texto: "Entendido", principal: true }],
    });
    dejarDeEsperar();
  }, LIMITE_ESPERA_MS);
}

function dejarDeEsperar() {
  window.clearTimeout(relojEspera);
  espera = null;
}

// Reacciona a lo que el sync acaba de confirmar o fallar.
function atenderCola(d: DetalleCola) {
  const aviso = decidirAviso(espera, d);
  switch (aviso.tipo) {
    case "propia-subida":
      modalEspera?.actualizar({
        titulo: "Registro subido al servidor",
        cuerpo: "La visita y sus fotos ya están guardadas en el servidor.",
        tono: "exito",
        acciones: [{ texto: "Listo", principal: true }],
      });
      dejarDeEsperar();
      break;
    case "propia-fallo":
      // NUNCA se presenta como pérdida: la visita sigue en la cola y se
      // reintenta sola. Decir "no se pudo" a secas haría que el agente
      // recapturara la visita, y ahí sí habría duplicados.
      modalEspera?.actualizar({
        titulo: "Todavía no se pudo subir",
        cuerpo:
          "El registro está guardado en el teléfono y se reintenta solo. " +
          "No hace falta volver a capturarlo.",
        nota: aviso.error,
        tono: "alerta",
        acciones: [{ texto: "Entendido", principal: true }],
      });
      dejarDeEsperar();
      break;
    case "otras-subidas":
      // Confirmaciones tardías: aviso discreto. Un popup aquí interrumpiría la
      // captura siguiente, y al volver la señal pueden confirmarse varias juntas.
      avisoDiscreto(textoOtrasSubidas(aviso.cuantas));
      break;
  }
}

function limpiarFormulario() {
  // Los previews SÍ se revocan: la vista Registros no los reusa, crea los suyos
  // desde el blob de la cola (ver regUrls en refrescarRegistros). Dejarlos vivos
  // acumulaba dos object URLs por cada visita capturada durante toda la jornada.
  for (const url of Object.values(estado.previews)) URL.revokeObjectURL(url);
  estado.tienda = null;
  estado.fotos = {};
  estado.previews = {};
  estado.datos = {};
  estado.notas = "";
  estado.cargandoFoto = {};
  estado.erroresFoto = {};
  // Empieza otra captura: si el permiso sigue bloqueado, vuelve a avisarse.
  avisoPermisoDado = false;
}

// ---- borrador: la captura a medio hacer no se pierde ----
//
// El 31 de agosto un teléfono se quedó sin memoria al tomar la foto y el
// navegador recargó la página con todo lo capturado adentro. La causa se arregló
// en comprimir.ts, pero la regla del proyecto es no perder evidencia NUNCA, y un
// navegador puede cerrar una pestaña por muchas razones. Así que lo capturado se
// resguarda conforme se trabaja y se ofrece de vuelta al reabrir.
//
// Se guarda en su propio store de IndexedDB (ver cola.ts): en el del catálogo se
// borraría al cambiar de agente.

async function guardarBorrador() {
  if (!estado.cliente || !estado.agente) return;
  // Sin fotos no hay nada que valga la pena rescatar: elegir una tienda se
  // rehace en dos toques, tomar las fotos no.
  const fotos = Object.values(estado.fotos);
  if (fotos.length === 0) {
    await cola.borrarBorrador();
    return;
  }
  try {
    await cola.guardarBorrador({
      cliente_id: estado.cliente.id,
      agente_id: estado.agente.id,
      agente_nombre: estado.agente.nombre,
      marca_id: estado.marca?.id ?? null,
      tienda: estado.tienda,
      fotos,
      datos: { ...estado.datos },
      notas: estado.notas,
      actualizado_en: new Date().toISOString(),
    });
  } catch {
    // Que falle el resguardo no puede estorbar la captura: la visita se guarda
    // igual cuando el agente toque Guardar.
  }
}

function programarBorrador() {
  window.clearTimeout(debounceBorrador);
  debounceBorrador = window.setTimeout(() => void guardarBorrador(), 1000);
}

// Al abrir: si quedó una captura a medias, se ofrece continuarla.
async function ofrecerBorrador() {
  let b: Borrador | undefined;
  try {
    b = await cola.leerBorrador();
  } catch {
    return;
  }
  if (!b || b.fotos.length === 0) return;

  const tienda = b.tienda?.nombre ?? "una tienda";
  const ajeno = b.agente_id !== estado.agente?.id;

  if (ajeno) {
    // No se borra: son fotos de alguien más, o sea evidencia. Solo se avisa.
    $("#banner")!.innerHTML = `
      <div class="bs-recuperar">
        <p class="bs-recuperar-t">Hay una captura sin terminar de ${esc(b.agente_nombre)}
        en ${esc(tienda)}, con ${b.fotos.length} foto(s). No se borra: para retomarla
        hay que entrar con ese agente.</p>
      </div>`;
    return;
  }

  $("#banner")!.innerHTML = `
    <div class="bs-recuperar">
      <p class="bs-recuperar-t">Quedó una captura sin terminar en <strong>${esc(
        tienda
      )}</strong> con ${b.fotos.length} foto(s).</p>
      <div class="bs-recuperar-b">
        <button class="bs-mini" id="btn-continuar">Continuar esa visita</button>
        <button class="bs-mini" id="btn-descartar">Descartar</button>
      </div>
    </div>`;

  $("#btn-continuar")!.addEventListener("click", () => void continuarBorrador(b!));
  $("#btn-descartar")!.addEventListener("click", async () => {
    await cola.borrarBorrador();
    $("#banner")!.innerHTML = "";
  });
}

async function continuarBorrador(b: Borrador) {
  const marca = estado.marcas.find((m) => m.id === b.marca_id);
  if (marca) estado.marca = marca;

  limpiarFormulario();
  estado.tienda = b.tienda;
  estado.datos = { ...b.datos };
  estado.notas = b.notas;
  for (const f of b.fotos) {
    estado.fotos[f.tipo] = f;
    // El blob viene del store; si por lo que sea falta, el slot queda vacío y se
    // vuelve a tomar la foto, en vez de mostrar una imagen rota.
    if (f.blob) estado.previews[f.tipo] = URL.createObjectURL(f.blob);
  }

  actualizarQuien();
  await precargarTiendas();
  renderFormulario();
  $("#banner")!.innerHTML = "";
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
          // Sin blob = la retención ya soltó la imagen (la foto vive en el
          // servidor). Se muestra un hueco, no una imagen rota.
          if (!f.blob) {
            return `<div class="bs-thumb is-liberada" title="Foto en el servidor">↑</div>`;
          }
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

  const liberadas = visitas.reduce(
    (s, v) => s + v.fotos.filter((f) => !f.blob).length,
    0
  );

  cont.innerHTML =
    stats +
    `<div class="bs-rows">${filas}</div>
     <p class="bs-note">Esta pestaña es lo que vive en <strong>este equipo</strong>. Cada registro guarda la hora real de captura y la de subida por separado: si hay diferencia entre las dos, el trabajo se hizo en tienda y se sincronizó después — no es una falla.<br><br>
     Las fotos se conservan en el teléfono ${HORAS_CONSERVAR_FOTOS} horas después de que el servidor las confirma${liberadas ? `; ${liberadas} ya se liberaron (la flecha ↑)` : ""}, y el registro local ${DIAS_CONSERVAR_REGISTRO} días — solo. Lo de más atrás se consulta en <strong>Historial</strong>. Nada sin confirmar se borra jamás.</p>`;
}

// ---- historial (consultado al servidor por rango de fechas) ----
//
// La cola local solo conserva lo reciente; el historial largo se le pregunta a
// Supabase cuando el agente lo pide. Las FOTOS no se cargan solas: cada una son
// ~200 KB de egress, así que se piden visita por visita al tocar "ver fotos".
let historialMontado = false;

function montarHistorial() {
  if (historialMontado) return;
  historialMontado = true;
  const body = $("#historial-body")!;
  body.innerHTML = `
    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">··</span><h2 class="bs-label">Rango de fechas</h2></div>
      <div class="bs-inner">
        <div class="bs-rango">
          <label class="bs-campo" style="flex:1">
            <span class="bs-campo-l">Desde</span>
            <input class="bs-input" type="date" id="hist-desde" value="${hoyMenosDias(7)}">
          </label>
          <label class="bs-campo" style="flex:1">
            <span class="bs-campo-l">Hasta</span>
            <input class="bs-input" type="date" id="hist-hasta" value="${hoyLocal()}">
          </label>
        </div>
        <label class="bs-check">
          <input type="checkbox" id="hist-solo-mias" checked>
          <span>Solo mis visitas</span>
        </label>
        <button class="bs-submit" id="btn-historial" style="margin-top:6px">Buscar</button>
      </div>
    </section>
    <div id="hist-resultados"></div>`;

  $("#btn-historial")!.addEventListener("click", () => void buscarHistorial());
  void buscarHistorial();
}

async function buscarHistorial() {
  const cont = $("#hist-resultados")!;
  if (!estado.cliente) return;
  if (!navigator.onLine) {
    cont.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0">
      El historial se consulta al servidor, así que necesita señal. Lo que capturaste
      sin conexión está en <strong>En el equipo</strong>.</p></section>`;
    return;
  }

  const desde = ($("#hist-desde") as HTMLInputElement).value;
  const hasta = ($("#hist-hasta") as HTMLInputElement).value;
  const soloMias = ($("#hist-solo-mias") as HTMLInputElement).checked;
  if (!desde || !hasta || desde > hasta) {
    cont.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0;color:#C4462B">
      Revisa el rango: la fecha de inicio no puede ser posterior a la del final.</p></section>`;
    return;
  }

  cont.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0">Consultando…</p></section>`;

  try {
    const visitas = await listarVisitas(
      estado.cliente.id,
      desde,
      hasta,
      soloMias ? estado.agente?.id : undefined
    );
    if (visitas.length === 0) {
      cont.innerHTML = `<div class="bs-empty"><p class="bs-empty-h">Sin visitas en ese rango</p>
        <p class="bs-empty-p">Prueba con otras fechas o desmarca "solo mis visitas".</p></div>`;
      return;
    }

    const filas = visitas
      .map((v) => {
        const gps = v.latitud != null ? `${v.latitud.toFixed(4)}, ${v.longitud!.toFixed(4)}` : "sin gps";
        return `
          <article class="bs-row" style="grid-template-columns:1fr">
            <div>
              <div class="bs-row-name">${esc(v.tienda_nombre ?? "(sin nombre)")}</div>
              <div class="bs-row-meta">No. ${esc(v.tienda_clave)}${
                v.cadena_nombre ? " · " + esc(v.cadena_nombre) : ""
              } · ${fmtFechaHora(v.capturada_en)}<br>${gps} · ${v.fotos} foto(s)${
          v.agente_nombre && !soloMias ? " · " + esc(v.agente_nombre) : ""
        }</div>
              ${v.notas ? `<div class="bs-row-meta" style="color:#14181B">“${esc(v.notas)}”</div>` : ""}
              <button class="bs-mini" data-visita="${esc(v.id)}" style="margin-top:8px">Ver fotos</button>
              <div class="bs-thumbs" id="fotos-${esc(v.id)}" style="margin-top:8px"></div>
            </div>
          </article>`;
      })
      .join("");

    cont.innerHTML = `
      <div class="bs-stats">
        <div class="bs-stat"><div class="bs-stat-n">${visitas.length}</div><div class="bs-stat-k">Visitas</div></div>
        <div class="bs-stat"><div class="bs-stat-n">${new Set(visitas.map((v) => v.tienda_clave)).size}</div><div class="bs-stat-k">Tiendas</div></div>
        <div class="bs-stat"><div class="bs-stat-n">${visitas.reduce((s, v) => s + v.fotos, 0)}</div><div class="bs-stat-k">Fotos</div></div>
      </div>
      <div class="bs-rows">${filas}</div>
      <p class="bs-note">Las fotos no se descargan solas: cada una pesa unos 200 KB y se piden solo al tocar “Ver fotos”, para no gastar datos del teléfono ni cuota del servidor.</p>`;

    cont.querySelectorAll<HTMLButtonElement>("[data-visita]").forEach((btn) => {
      btn.addEventListener("click", () => void verFotos(btn));
    });
  } catch (e) {
    cont.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0;color:#C4462B">
      No se pudo consultar el historial: ${esc(e instanceof Error ? e.message : String(e))}</p></section>`;
  }
}

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
          `<a href="${f.url}" target="_blank" rel="noopener">
             <img class="bs-thumb" src="${f.url}" alt="${esc(f.tipo)}" loading="lazy">
           </a>`
      )
      .join("");
    btn.textContent = fotos.length ? "Ocultar fotos" : "Sin fotos";
  } catch {
    btn.textContent = "No se pudieron cargar";
  }
}

// ---- barra de cola ----
// Último conteo de pendientes. `beforeunload` es síncrono: no puede consultar
// IndexedDB, así que necesita el dato ya calculado.
let pendientesCache = 0;

async function refrescarQueue() {
  const visitas = await cola.listar();
  const pend = visitas.filter((v) => v.estado === "pendiente" || v.estado === "error").length;
  pendientesCache = pend;
  $("#tab-count")!.textContent = String(visitas.length);
  const n = $("#queue-n")!;
  n.textContent = String(pend).padStart(2, "0");
  n.className = "bs-queue-n" + (pend ? "" : " is-clear");
  $("#queue-sub")!.textContent =
    pend === 0 ? "Todo sincronizado" : navigator.onLine ? "Subiendo en segundo plano…" : "Guardados en el teléfono";
}

// ---- almacenamiento del teléfono ----
//
// Dos cosas distintas:
//  1. Pedir almacenamiento PERSISTENTE, que saca a la app de la lista de
//     desalojo automático del navegador. Sin esto, un teléfono corto de espacio
//     puede borrar los datos del sitio completos, con visitas sin subir adentro.
//  2. Avisar si el espacio se está acabando, ANTES de que fallen las escrituras:
//     cuando fallan, lo que se cae es guardar la foto recién tomada.
async function revisarAlmacenamiento() {
  await asegurarPersistencia();

  const e = await espacio();
  if (!e?.apretado) return;
  abrirModal({
    titulo: "Al teléfono le queda poco espacio",
    cuerpo:
      `Quedan ${e.libreMB} MB libres para la app. Si se llena, el teléfono puede ` +
      `dejar de guardar las fotos que tomes.`,
    nota: "Borra fotos o apps que no uses. Los registros ya subidos se liberan solos a las 48 horas.",
    tono: "alerta",
    acciones: [{ texto: "Entendido", principal: true }],
  });
}

// ---- caídas del navegador ----
//
// Si la app abre y quedó un rastro sin cerrar, la pestaña murió a media captura.
// Se avisa, se dice qué se sabe y —cuando murió con la cámara del sistema al
// frente— se cambia solo el modo de cámara, porque ese caso no se arregla de
// ninguna otra forma desde la página.

function mostrarCaida(c: Caida) {
  const enLaCamara = murioEnLaCamara(c);
  if (enLaCamara && soportaCamara()) ponerCamaraEnApp(true);

  const explicacion = enLaCamara
    ? soportaCamara()
      ? `El teléfono se quedó sin memoria <strong>mientras estaba abierta la cámara del sistema</strong>,
         antes de que la app recibiera la foto. Ya se activó <strong>tomar las fotos dentro de la app</strong>
         en este teléfono: vuelve a intentar la foto y no debería volver a pasar.`
      : `El teléfono se quedó sin memoria mientras estaba abierta la cámara del sistema.
         Cierra las demás apps antes de capturar.`
    : `La app se cerró sola mientras procesaba la foto. Lo capturado hasta ese momento
       se resguardó y se puede continuar.`;

  $("#banner")!.insertAdjacentHTML(
    "beforeend",
    `<div class="bs-recuperar">
      <p class="bs-recuperar-t">${explicacion}</p>
      <div class="bs-recuperar-b">
        <button class="bs-mini" id="btn-ver-caida">Ver detalle</button>
        <button class="bs-mini" id="btn-ok-caida">Entendido</button>
      </div>
      <pre class="bs-rastro" id="rastro-caida" hidden></pre>
    </div>`
  );

  $("#btn-ver-caida")!.addEventListener("click", () => {
    const pre = $("#rastro-caida")!;
    pre.textContent = listarCaidas().map(comoTexto).join("\n\n———\n\n");
    pre.hidden = !pre.hidden;
  });
  $("#btn-ok-caida")!.addEventListener("click", () => {
    olvidarCaidas();
    $("#banner")!.innerHTML = "";
  });
}

// ---- init ----
export async function init() {
  const root = document.getElementById("app");
  if (!root) return;

  // ANTES que nada: leer si la sesión anterior murió a media foto. Tiene que ser
  // aquí, porque el propio flujo de captura vuelve a escribir el rastro.
  const caida = revisarCaida();

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
  window.addEventListener("cola-cambio", (e) => {
    void refrescarQueue();
    if (estado.vista === "registros") void refrescarRegistros();
    const d = (e as CustomEvent<DetalleCola>).detail;
    // purgarSilencioso() también dispara este evento, sin detalle.
    if (d) atenderCola(d);
  });

  // Avisar si se cierra la app con evidencia sin subir. Los reintentos viven en
  // la página: al cerrarla dejan de correr hasta que se vuelva a abrir. La cola
  // en IndexedDB sobrevive, así que no se pierde nada — pero el agente merece
  // saber que quedó trabajo colgado.
  window.addEventListener("beforeunload", (e) => {
    if (pendientesCache <= 0) return;
    e.preventDefault();
    // `returnValue` está marcado como deprecado, pero Chrome todavía lo exige
    // para mostrar el diálogo: solo con preventDefault() no sale nada. El texto
    // propio ya no se muestra (los navegadores ponen el suyo), y aun así se
    // manda: es lo que quedaría si algún navegador vuelve a respetarlo.
    e.returnValue = textoPendientesAlSalir(pendientesCache) ?? "";
  });

  // Sacar la cola de la lista de desalojo del navegador. Sin esto, IndexedDB es
  // "best-effort" y un teléfono corto de espacio puede llevarse las visitas sin
  // subir. Es el único camino por el que hoy se podía perder evidencia.
  void revisarAlmacenamiento();

  await cargarContexto(ctx);
  // Con el formulario ya montado: si quedó una captura a medias, ofrecerla.
  await ofrecerBorrador();
  // Y si la sesión anterior se murió, explicarlo. Va después del borrador para
  // que el aviso quede debajo del botón de continuar, no encima.
  if (caida) mostrarCaida(caida);
  // Suelta lo que ya está confirmado y viejo antes de nada, para que el teléfono
  // no arranque la jornada con la memoria llena.
  await purgarSilencioso();
  await refrescarQueue();
  iniciarSync();
}
