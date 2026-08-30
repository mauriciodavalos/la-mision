// Controlador de /admin/tiendas: elegir cliente y cadena, leer el CSV, REVISAR
// antes de escribir, y escribir con upsert idempotente.
//
// El archivo se lee en el navegador y nunca se sube: solo viajan las filas ya
// validadas. Ver importar-tiendas.ts para el parseo y la escritura.

import { listarCadenas, listarClientes } from "./catalogo";
import { importarTiendas, revisarCSV, type Revision } from "./importar-tiendas";
import type { Cadena, Cliente } from "./tipos";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T | null;

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

let clientes: Cliente[] = [];
let cadenas: Cadena[] = [];
let cliente: Cliente | null = null;
let cadena: Cadena | null = null;
let revision: Revision | null = null;

function opciones(items: { id: string; nombre: string }[], sel?: string): string {
  return items
    .map((i) => `<option value="${esc(i.id)}"${i.id === sel ? " selected" : ""}>${esc(i.nombre)}</option>`)
    .join("");
}

function render() {
  const body = $("#admin-body")!;
  body.innerHTML = `
    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">01</span><h2 class="bs-label">Cliente</h2></div>
      <div class="bs-inner"><select class="bs-select" id="sel-cliente">${opciones(clientes, cliente?.id)}</select></div>
    </section>

    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">02</span><h2 class="bs-label">Cadena</h2></div>
      <p class="bs-hint">Las claves de sucursal son propias de cada cadena, así que el archivo se carga contra una.</p>
      <div class="bs-inner"><select class="bs-select" id="sel-cadena">${
        cadenas.length ? opciones(cadenas, cadena?.id) : '<option value="">(este cliente no tiene cadenas)</option>'
      }</select></div>
    </section>

    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">03</span><h2 class="bs-label">Archivo CSV</h2></div>
      <p class="bs-hint">
        Columnas: <strong>clave_sucursal</strong> (obligatoria), nombre, direccion, municipio, estado, latitud, longitud.
        Se aceptan sinónimos comunes (clave, no_tienda, sucursal, ciudad, entidad, lat, lng) y separador coma o punto y coma.
      </p>
      <div class="bs-inner"><input class="bs-input" type="file" accept=".csv,text/csv" id="archivo"></div>
    </section>

    <div id="preview"></div>
  `;

  $("#sel-cliente")!.addEventListener("change", async (e) => {
    const id = (e.target as HTMLSelectElement).value;
    cliente = clientes.find((c) => c.id === id) ?? null;
    revision = null;
    await cargarCadenas();
    render();
  });

  $("#sel-cadena")!.addEventListener("change", (e) => {
    const id = (e.target as HTMLSelectElement).value;
    cadena = cadenas.find((c) => c.id === id) ?? null;
  });

  $("#archivo")!.addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      revision = revisarCSV(String(lector.result ?? ""));
      renderPreview();
    };
    lector.readAsText(f, "utf-8");
  });

  if (revision) renderPreview();
}

function renderPreview() {
  const cont = $("#preview")!;
  if (!revision) {
    cont.innerHTML = "";
    return;
  }
  const { validas, invalidas, duplicadas } = revision;
  const conAviso = validas.filter((v) => v.error);

  const muestra = validas
    .slice(0, 10)
    .map(
      (v) => `<article class="bs-row" style="grid-template-columns:1fr">
        <div>
          <div class="bs-row-name">${esc(v.fila!.nombre ?? "(sin nombre)")}</div>
          <div class="bs-row-meta">No. ${esc(v.fila!.clave_sucursal)}${
            v.fila!.municipio ? " · " + esc(v.fila!.municipio) : ""
          }${v.fila!.estado ? ", " + esc(v.fila!.estado) : ""}${
            v.fila!.latitud != null ? ` · ${v.fila!.latitud}, ${v.fila!.longitud}` : " · sin gps"
          }</div>
        </div>
      </article>`
    )
    .join("");

  const listaErrores = invalidas
    .slice(0, 20)
    .map((e) => `<li>Línea ${e.linea}: ${esc(e.error ?? "")}</li>`)
    .join("");

  cont.innerHTML = `
    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">04</span><h2 class="bs-label">Revisión</h2></div>
      <div class="bs-inner">
        <div class="bs-stats">
          <div class="bs-stat"><div class="bs-stat-n">${validas.length}</div><div class="bs-stat-k">Listas</div></div>
          <div class="bs-stat"><div class="bs-stat-n" style="${invalidas.length ? "color:#C4462B" : ""}">${invalidas.length}</div><div class="bs-stat-k">Con error</div></div>
          <div class="bs-stat"><div class="bs-stat-n">${duplicadas.length}</div><div class="bs-stat-k">Claves repetidas</div></div>
        </div>
        ${
          invalidas.length
            ? `<p class="bs-hint" style="margin-left:0;color:#C4462B">Estas filas NO se van a escribir:</p>
               <ul class="bs-hint" style="margin-left:0">${listaErrores}</ul>
               ${invalidas.length > 20 ? `<p class="bs-hint" style="margin-left:0">…y ${invalidas.length - 20} más.</p>` : ""}`
            : ""
        }
        ${
          conAviso.length
            ? `<p class="bs-hint" style="margin-left:0">${conAviso.length} fila(s) con coordenadas fuera de rango: se guardan sin GPS.</p>`
            : ""
        }
        ${validas.length ? `<p class="bs-hint" style="margin-left:0">Muestra de las primeras ${Math.min(10, validas.length)}:</p><div class="bs-rows">${muestra}</div>` : ""}
      </div>
    </section>
    <button class="bs-submit" id="btn-importar"${validas.length && cadena ? "" : " disabled"}>
      Escribir ${validas.length} tienda(s)
    </button>
    <p class="bs-missing" id="msg-importar">${
      !cadena ? "Falta elegir cadena" : "Reimportar el mismo archivo actualiza, no duplica."
    }</p>`;

  const btn = $("#btn-importar") as HTMLButtonElement | null;
  btn?.addEventListener("click", async () => {
    if (!cliente || !cadena || !revision) return;
    btn.disabled = true;
    btn.textContent = "Escribiendo…";
    const msg = $("#msg-importar")!;
    const filas = revision.validas.map((v) => v.fila!);
    const r = await importarTiendas(cliente.id, cadena.id, filas);
    if (r.errores.length) {
      msg.style.color = "#C4462B";
      msg.innerHTML = `Escritas ${r.escritas} de ${filas.length}. Errores:<br>${r.errores.map(esc).join("<br>")}`;
      btn.disabled = false;
      btn.textContent = `Reintentar (${filas.length})`;
    } else {
      msg.style.color = "#5C6660";
      msg.textContent = `Listo: ${r.escritas} tienda(s) escritas en ${cadena.nombre}.`;
      btn.textContent = "Importado";
    }
  });
}

async function cargarCadenas() {
  cadenas = cliente ? await listarCadenas(cliente.id) : [];
  cadena = cadenas[0] ?? null;
}

export async function init() {
  const body = $("#admin-body");
  if (!body) return;
  try {
    clientes = await listarClientes();
  } catch (e) {
    body.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0;color:#C4462B">
      No se pudo leer el catálogo: ${esc(e instanceof Error ? e.message : String(e))}</p></section>`;
    return;
  }
  if (clientes.length === 0) {
    body.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0">
      No hay clientes dados de alta. Corre supabase/alta_cliente.sql primero.</p></section>`;
    return;
  }
  cliente = clientes[0];
  await cargarCadenas();
  render();
}
