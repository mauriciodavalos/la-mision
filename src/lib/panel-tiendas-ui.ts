// Catálogo de sucursales de UNA empresa: /<slug>/tiendas
//
// POR QUÉ EXISTE
//
// Hasta hoy las 264 tiendas solo se podían ver entrando a la tabla de Supabase.
// `/admin/tiendas` importa CSV, no muestra nada. Mauricio preguntó dónde están
// las tiendas de cada cliente y no había respuesta que darle que no fuera "en la
// base".
//
// LO QUE RESUELVE, ADEMÁS DE MIRAR
//
// Las 264 sucursales tienen `latitud` y `longitud` en NULL, y esa es la razón de
// que el 60% de las visitas capturadas no se pueda validar por distancia: son la
// primera a esa tienda, así que no hay contra qué compararlas. La salida es
// cargar las coordenadas, y el camino más corto para hacerlo es el que ya
// existe: se descarga el catálogo en CSV, se llenan las columnas de latitud y
// longitud, y se vuelve a importar por `/admin/tiendas` — que ya reconoce esas
// columnas y hace `upsert` sobre (cadena, clave), así que reimportar actualiza
// en vez de duplicar. Por eso el CSV que se baja de aquí ya trae las dos
// columnas vacías y en el orden correcto.
//
// COSTO: una consulta de catálogo (unos KB, cacheada) y una de visitas para
// saber qué sucursales ya se pisaron. Cero fotos.

import { clientePorSlug, listarTiendas } from "./catalogo";
import { rutaDeEmpresa } from "./ruta";
import { asegurarIdentidad } from "./identidad-ui";
import { olvidarIdentidad } from "./identidad";
import { hoyLocal, listarVisitas } from "./historial";
import type { Agente, Cliente, Tienda } from "./tipos";

interface Fila extends Tienda {
  visitas: number;
  ultima: string | null;
}

const estado = {
  admin: null as Agente | null,
  cliente: null as Cliente | null,
  filas: [] as Fila[],
  filtro: "" as string,
  soloSinCoordenadas: false,
};

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector(s) as T | null;

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit", month: "short", timeZone: "America/Mexico_City",
  });
}

function pantallaSimple(root: HTMLElement, titulo: string, cuerpo: string, conSalir = false) {
  root.innerHTML = `
    <header class="bs-head"><div class="bs-shell" style="padding-bottom:18px">
      <p class="bs-brand">La Misión · Catálogo</p><h1 class="bs-title">${titulo}</h1>
    </div></header>
    <main class="bs-shell"><div class="bs-body"><section class="bs-field">
      <p class="bs-hint" style="margin-left:0">${cuerpo}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${conSalir ? `<button class="bs-mini" id="salir">Entrar con otro agente</button>` : ""}
        <a class="bs-mini" href="/" style="text-decoration:none">Ir al inicio</a>
      </div>
    </section></div></main>`;
  $("#salir")?.addEventListener("click", async () => {
    await olvidarIdentidad();
    location.reload();
  });
}

// ---- CSV para llenar las coordenadas ----
//
// Se arma con las MISMAS columnas que reconoce importar-tiendas.ts, para que el
// archivo que se baja aquí se pueda volver a subir sin renombrar nada.
function comoCsv(filas: Fila[]): string {
  const campo = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cab = ["clave_sucursal", "nombre", "direccion", "municipio", "estado", "latitud", "longitud"];
  const cuerpo = filas.map((t) =>
    [t.clave_sucursal, t.nombre, t.direccion, t.municipio, t.estado,
     t.latitud, t.longitud].map(campo).join(",")
  );
  // Marca de orden de bytes (U+FEFF) al inicio. Sin ella, Excel en Windows abre
  // el CSV como ANSI y "Aurrerá" llega convertido en basura — y el archivo
  // regresa así al reimportarse.
  //
  // Se construye con fromCharCode en vez de escribir el carácter: en el código
  // fuente es invisible, así que nadie puede ver si está, si se duplicó o si
  // alguien lo borró sin querer.
  //
  // Para comprobar que el CSV lo lleva hay que mirar los BYTES (ef bb bf). No
  // sirve `blob.text()`: el decodificador de UTF-8 se come el BOM, así que
  // reporta que no está sobre un archivo que sí lo trae.
  const BOM = String.fromCharCode(0xfeff);
  return BOM + [cab.join(","), ...cuerpo].join("\r\n") + "\r\n";
}

function descargarCsv() {
  const filas = visibles();
  const blob = new Blob([comoCsv(filas)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tiendas-${estado.cliente!.slug}-${hoyLocal()}.csv`;
  a.click();
  // Sin esto el blob se queda en memoria hasta que se cierre la pestaña.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- pintado ----

function visibles(): Fila[] {
  const t = norm(estado.filtro);
  return estado.filas.filter((f) => {
    if (estado.soloSinCoordenadas && f.latitud != null) return false;
    if (!t) return true;
    return (
      norm(f.clave_sucursal).includes(t) ||
      norm(f.nombre ?? "").includes(t) ||
      norm(f.municipio ?? "").includes(t) ||
      norm(f.estado ?? "").includes(t)
    );
  });
}

function renderLista() {
  const cont = $("#t-lista")!;
  const filas = visibles();
  $("#t-cuantas")!.textContent =
    filas.length === estado.filas.length
      ? `${filas.length} sucursales`
      : `${filas.length} de ${estado.filas.length}`;

  if (filas.length === 0) {
    cont.innerHTML = `<p class="bs-hint" style="margin-left:0">Ninguna sucursal coincide.</p>`;
    return;
  }

  cont.innerHTML = filas
    .map((f) => {
      const gps =
        f.latitud != null && f.longitud != null
          ? `<a class="bs-tienda-gps" href="https://www.google.com/maps?q=${f.latitud},${f.longitud}"
               target="_blank" rel="noopener">${f.latitud.toFixed(4)}, ${f.longitud.toFixed(4)}</a>`
          : `<span class="bs-tienda-sin">sin coordenadas</span>`;
      const dir = [f.direccion, f.municipio, f.estado]
        .filter(Boolean).map(String).join(" · ");
      const vis =
        f.visitas === 0
          ? `<span class="bs-tienda-nunca">sin visitar</span>`
          : `${f.visitas} visita${f.visitas > 1 ? "s" : ""} · última ${fmtFecha(f.ultima!)}`;
      return `
        <article class="bs-tienda">
          <div class="bs-tienda-clave">${esc(f.clave_sucursal)}</div>
          <div>
            <div class="bs-tienda-n">${esc(f.nombre ?? "(sin nombre)")}</div>
            <div class="bs-row-meta">${dir ? esc(dir) + "<br>" : ""}${gps} · ${vis}</div>
          </div>
        </article>`;
    })
    .join("");
}

function render(root: HTMLElement) {
  const conGps = estado.filas.filter((f) => f.latitud != null).length;
  const visitadas = estado.filas.filter((f) => f.visitas > 0).length;
  const total = estado.filas.length;

  root.innerHTML = `
    <header class="bs-head"><div class="bs-shell is-wide" style="padding-bottom:18px">
      <div class="bs-head-top">
        <div>
          <p class="bs-brand">La Misión · Catálogo</p>
          <h1 class="bs-title">${esc(estado.cliente!.nombre)}</h1>
          <p class="bs-quien">
            <span>${esc(estado.admin?.nombre ?? "")}</span>
            <span class="bs-admin">admin</span>
            <a class="bs-quien-btn" href="/${esc(estado.cliente!.slug)}/panel"
               style="text-decoration:none">ver su tablero</a>
          </p>
        </div>
      </div>
    </div></header>

    <main class="bs-shell is-wide"><div class="bs-body">
      <div class="bs-stats bs-stats-4">
        <div class="bs-stat"><div class="bs-stat-n">${total}</div><div class="bs-stat-k">Sucursales</div></div>
        <div class="bs-stat"><div class="bs-stat-n">${visitadas}</div><div class="bs-stat-k">Visitadas</div></div>
        <div class="bs-stat"><div class="bs-stat-n${conGps ? "" : " is-alerta"}">${conGps}</div>
          <div class="bs-stat-k">Con coordenadas</div></div>
        <div class="bs-stat"><div class="bs-stat-n">${total - conGps}</div>
          <div class="bs-stat-k">Sin coordenadas</div></div>
      </div>

      ${
        conGps < total
          ? `<p class="bs-hint" style="margin-left:0;padding-top:12px">
              <strong>${total - conGps} sucursales no tienen punto registrado.</strong>
              Mientras no lo tengan, una visita solo se puede comparar contra otras
              visitas a la misma tienda — y la primera vez que alguien pisa una
              sucursal no hay con qué compararla. Para cargarlas: baja el CSV, llena
              las columnas <code>latitud</code> y <code>longitud</code>, y súbelo en
              <a href="/admin/tiendas">/admin/tiendas</a>. Reimportar actualiza, no
              duplica.</p>`
          : ""
      }

      <section class="bs-field">
        <div class="bs-inner" style="margin-left:0">
          <div class="bs-filtros">
            <label class="bs-campo" style="flex:1 1 220px">
              <span class="bs-campo-l">Buscar</span>
              <input class="bs-input" id="t-buscar" autocomplete="off"
                     placeholder="clave, nombre, municipio" value="${esc(estado.filtro)}">
            </label>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:4px">
            <label class="bs-auto">
              <input type="checkbox" id="t-solo-sin" ${estado.soloSinCoordenadas ? "checked" : ""}>
              <span>solo sin coordenadas</span>
            </label>
            <button class="bs-mini" id="t-csv">Bajar CSV</button>
            <span class="bs-row-meta" id="t-cuantas"></span>
          </div>
        </div>
      </section>

      <div class="bs-tiendas" id="t-lista"></div>

      <p class="bs-note">El CSV se baja con las mismas columnas que reconoce el
      importador, así que se puede llenar y volver a subir sin renombrar nada. Se
      descarga lo que esté filtrado en pantalla.</p>
    </div></main>`;

  const buscar = $("#t-buscar") as HTMLInputElement;
  buscar.addEventListener("input", () => {
    estado.filtro = buscar.value;
    renderLista();
  });
  ($("#t-solo-sin") as HTMLInputElement).addEventListener("change", (e) => {
    estado.soloSinCoordenadas = (e.target as HTMLInputElement).checked;
    renderLista();
  });
  $("#t-csv")!.addEventListener("click", descargarCsv);
  renderLista();
}

// ---- arranque ----

export async function init() {
  const root = document.getElementById("app");
  if (!root) return;

  const ruta = rutaDeEmpresa(location.pathname);
  if (!ruta) {
    pantallaSimple(root, "Falta la<br>empresa",
      "Esta dirección necesita el nombre corto de la empresa: <strong>/&lt;empresa&gt;/tiendas</strong>.");
    return;
  }

  const ctx = await asegurarIdentidad(root);
  if (!ctx) return;
  if (!ctx.agente.es_admin) {
    pantallaSimple(root, "Solo para<br>administradores",
      `Entraste como <strong>${esc(ctx.agente.nombre)}</strong>, que no tiene permiso de
       administrador.`, true);
    return;
  }
  estado.admin = ctx.agente;

  let cliente: Cliente | null = null;
  try {
    cliente = await clientePorSlug(ruta.slug);
  } catch {
    pantallaSimple(root, "Sin conexión",
      "No se pudo leer la empresa desde el servidor. Revisa la señal y recarga.", true);
    return;
  }
  if (!cliente) {
    pantallaSimple(root, "Empresa<br>no encontrada",
      `No hay ninguna empresa activa con el nombre corto <strong>${esc(ruta.slug)}</strong>.`, true);
    return;
  }
  estado.cliente = cliente;

  root.innerHTML = `<header class="bs-head"><div class="bs-shell" style="padding-bottom:18px">
    <p class="bs-brand">La Misión · Catálogo</p><h1 class="bs-title">Cargando…</h1>
  </div></header>`;

  const tiendas = await listarTiendas(cliente.id, ctx.agente);
  // Las visitas solo sirven para decir cuáles ya se pisaron. Se pide un rango
  // amplio y una sola vez; es texto, unos pocos KB.
  let visitas: Awaited<ReturnType<typeof listarVisitas>> = [];
  try {
    visitas = await listarVisitas(cliente.id, "2026-01-01", hoyLocal());
  } catch {
    // Sin esto la pantalla sigue sirviendo: se ve el catálogo, sin el conteo.
  }
  const cuenta = new Map<string, { n: number; ultima: string }>();
  for (const v of visitas) {
    const a = cuenta.get(v.tienda_id);
    if (!a) cuenta.set(v.tienda_id, { n: 1, ultima: v.capturada_en });
    else {
      a.n++;
      if (v.capturada_en > a.ultima) a.ultima = v.capturada_en;
    }
  }

  estado.filas = tiendas.map((t) => ({
    ...t,
    visitas: cuenta.get(t.id)?.n ?? 0,
    ultima: cuenta.get(t.id)?.ultima ?? null,
  }));

  render(root);
}
