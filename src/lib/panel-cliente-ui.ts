// Tablero de UNA empresa, en su propia URL: /<slug>/panel
//
// QUÉ LO DISTINGUE DEL OTRO PANEL
//
// `/admin/reportes` contesta "¿qué hizo el equipo?" y tiene un selector de
// empresa. Este contesta "¿cómo va ESTA empresa y qué tan confiable es lo que se
// capturó?": llega con la empresa resuelta desde la URL, no se puede cambiar, y
// cada visita viene con sus señales de validación en vez de solo su fila.
//
// EL NOMBRE DEL CLIENTE NO ESTÁ EN NINGÚN LADO DEL CÓDIGO. La URL trae el slug
// (`bikes-shot`), que ya vive en la base desde 0005_slugs.sql, y de ahí sale
// todo. Un cliente nuevo funciona sin tocar una línea ni volver a desplegar.
//
// ALCANCE DE LA PUERTA — LÉASE ANTES DE COMPARTIR LA LIGA
//
// Entra quien se identifique como agente con `es_admin`, igual que el otro panel.
// Eso evita entradas por equivocación; NO es una cerradura. En fase 1 la RLS está
// apagada y la key publishable viaja en el bundle, así que quien tenga esta liga
// puede cambiar el slug por el de la otra empresa y leer sus datos. Mientras la
// abra quien administra, bien. Para dársela al cliente hace falta fase 2:
// Supabase Auth + RLS (9999_rls_fase2.sql.txt).
//
// COSTO
//
// Al abrir no se descarga nada: hay que tocar "Consultar", igual que en el otro
// panel. Una consulta trae la lista en texto (unos KB) y el catálogo de tiendas
// del cliente (unos KB más, cacheado), que es lo que permite calcular cobertura.
// Las fotos siguen siendo bajo demanda, ~200 KB cada una.

import { clientePorSlug, listarMarcas, listarTiendas } from "./catalogo";
import { slugDeLaUrl } from "./ruta";
import { asegurarIdentidad } from "./identidad-ui";
import { olvidarIdentidad } from "./identidad";
import { fotosDeVisita, hoyLocal, listarVisitas, type VisitaHistorial } from "./historial";
import { historialDeCorrecciones } from "./corregir-visita";
import {
  aRevisar,
  puntoDeReferencia,
  validar,
  type Referencia,
  type Senal,
  type VisitaValidable,
} from "./validacion";
import type { Agente, Cliente, Marca, Tienda } from "./tipos";

const LLAVE_RANGO = "lamision.tablero.rango";

const estado = {
  admin: null as Agente | null,
  cliente: null as Cliente | null,
  tiendas: [] as Tienda[],
  marcas: [] as Marca[],
  visitas: [] as VisitaHistorial[],
  senales: new Map<string, Senal[]>(),
  consultado: false,
  cargando: false,
};

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector(s) as T | null;

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

/** Día local de una captura, para agrupar duplicados del mismo día. */
function diaLocal(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

function inicioDeMes(): string {
  return hoyLocal().slice(0, 8) + "01";
}

// ---- validación de todo lo que está en pantalla ----

function fotosEsperadas(marcaId: string): number {
  const m = estado.marcas.find((x) => x.id === marcaId);
  const fotos = m?.config_captura?.fotos ?? [];
  const obligatorias = fotos.filter((f) => f.obligatoria).length;
  // Sin configuración legible, se exige al menos una foto: decir "0 de 0 ok"
  // sería peor que quedarse corto.
  return obligatorias || fotos.length || 1;
}

function comoValidable(v: VisitaHistorial): VisitaValidable {
  return {
    id: v.id,
    capturada_en: v.capturada_en,
    latitud: v.latitud,
    longitud: v.longitud,
    precision_gps: v.precision_gps,
    agente_id: v.agente_id,
    tienda_id: v.tienda_id,
    marca_id: v.marca_id,
    fotos: v.fotos,
    correcciones: historialDeCorrecciones(v.datos).length,
  };
}

function validarTodo() {
  estado.senales.clear();
  const vs = estado.visitas.map(comoValidable);

  // Referencia por tienda. OJO: se arma con TODAS las visitas del rango
  // consultado, así que un rango de un solo día da referencias más pobres que
  // uno de un mes. Es una consecuencia real y por eso la señal dice contra qué
  // se comparó.
  const porTienda = new Map<string, VisitaValidable[]>();
  for (const v of vs) {
    if (!porTienda.has(v.tienda_id)) porTienda.set(v.tienda_id, []);
    porTienda.get(v.tienda_id)!.push(v);
  }
  const refs = new Map<string, Referencia | null>();
  for (const [id, lista] of porTienda) {
    const t = estado.tiendas.find((x) => x.id === id);
    refs.set(id, puntoDeReferencia(lista, t ? { lat: t.latitud ?? null, lng: t.longitud ?? null } : null));
  }

  // Duplicados: misma tienda + marca + día.
  const cuenta = new Map<string, number>();
  for (const v of vs) {
    const k = `${diaLocal(v.capturada_en)}|${v.tienda_id}|${v.marca_id}`;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }

  // La "anterior" es la visita previa del MISMO agente por hora de captura, así
  // que hay que recorrer en orden ascendente aunque se muestre al revés.
  const asc = [...vs].sort((a, b) => a.capturada_en.localeCompare(b.capturada_en));
  const ultima = new Map<string, VisitaValidable>();
  for (const v of asc) {
    estado.senales.set(
      v.id,
      validar(v, {
        referencia: refs.get(v.tienda_id) ?? null,
        anterior: ultima.get(v.agente_id) ?? null,
        fotosEsperadas: fotosEsperadas(v.marca_id),
        otrasDelDia: (cuenta.get(`${diaLocal(v.capturada_en)}|${v.tienda_id}|${v.marca_id}`) ?? 1) - 1,
      })
    );
    ultima.set(v.agente_id, v);
  }
}

// ---- pantallas ----

function pantallaSimple(root: HTMLElement, titulo: string, cuerpo: string, conSalir = false) {
  root.innerHTML = `
    <header class="bs-head"><div class="bs-shell" style="padding-bottom:18px">
      <p class="bs-brand">La Misión · Tablero</p>
      <h1 class="bs-title">${titulo}</h1>
    </div></header>
    <main class="bs-shell"><div class="bs-body"><section class="bs-field">
      <p class="bs-hint" style="margin-left:0">${cuerpo}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${conSalir ? `<button class="bs-mini" id="salir">Entrar con otro agente</button>` : ""}
        <a class="bs-mini" href="/captura" style="text-decoration:none">Ir a capturar</a>
      </div>
    </section></div></main>`;
  $("#salir")?.addEventListener("click", async () => {
    await olvidarIdentidad();
    location.reload();
  });
}

function montar(root: HTMLElement) {
  let rango: { desde: string; hasta: string };
  try {
    rango = JSON.parse(localStorage.getItem(LLAVE_RANGO) ?? "null") ?? {
      desde: inicioDeMes(), hasta: hoyLocal(),
    };
  } catch {
    rango = { desde: inicioDeMes(), hasta: hoyLocal() };
  }

  root.innerHTML = `
    <header class="bs-head"><div class="bs-shell is-wide" style="padding-bottom:18px">
      <div class="bs-head-top">
        <div>
          <p class="bs-brand">La Misión · Tablero</p>
          <h1 class="bs-title">${esc(estado.cliente!.nombre)}</h1>
          <p class="bs-quien">
            <span>${esc(estado.admin?.nombre ?? "")}</span>
            <span class="bs-admin">admin</span>
            <a class="bs-quien-btn" href="/${esc(estado.cliente!.slug)}/tiendas"
               style="text-decoration:none">sus tiendas</a>
            <a class="bs-quien-btn" href="/admin/reportes" style="text-decoration:none">todos los clientes</a>
          </p>
        </div>
        <span class="bs-chip is-on" id="chip"><span class="bs-dot is-live"></span><span id="chip-txt">En línea</span></span>
      </div>
    </div></header>

    <main class="bs-shell is-wide"><div class="bs-body">
      <section class="bs-field">
        <div class="bs-legend"><span class="bs-num">01</span><h2 class="bs-label">Periodo</h2></div>
        <p class="bs-hint">Nada se descarga hasta que toques Consultar.</p>
        <div class="bs-inner">
          <div class="bs-rango">
            <label class="bs-campo"><span class="bs-campo-l">Desde</span>
              <input class="bs-input" type="date" id="t-desde" value="${esc(rango.desde)}"></label>
            <label class="bs-campo"><span class="bs-campo-l">Hasta</span>
              <input class="bs-input" type="date" id="t-hasta" value="${esc(rango.hasta)}"></label>
          </div>
          <button class="bs-submit" id="t-consultar" style="margin-top:6px">Consultar</button>
        </div>
      </section>
      <div id="t-salida"></div>
    </div></main>

    <div class="bs-toast" id="t-toast" role="status" aria-live="polite"></div>`;

  $("#t-consultar")!.addEventListener("click", () => void consultar());
  const recordar = () => {
    try {
      localStorage.setItem(LLAVE_RANGO, JSON.stringify({
        desde: ($("#t-desde") as HTMLInputElement).value,
        hasta: ($("#t-hasta") as HTMLInputElement).value,
      }));
    } catch { /* modo privado: solo no se recuerda */ }
  };
  $("#t-desde")!.addEventListener("change", recordar);
  $("#t-hasta")!.addEventListener("change", recordar);

  const chip = () => {
    const c = $("#chip")!;
    c.className = "bs-chip " + (navigator.onLine ? "is-on" : "is-off");
    $("#chip-txt")!.textContent = navigator.onLine ? "En línea" : "Sin conexión";
  };
  window.addEventListener("online", chip);
  window.addEventListener("offline", chip);

  $("#t-salida")!.innerHTML = `
    <div class="bs-empty">
      <p class="bs-empty-h">Sin consultar</p>
      <p class="bs-empty-p">Elige el periodo y toca Consultar.</p>
    </div>`;
}

async function consultar() {
  const salida = $("#t-salida")!;
  const desde = ($("#t-desde") as HTMLInputElement).value;
  const hasta = ($("#t-hasta") as HTMLInputElement).value;

  if (!desde || !hasta || desde > hasta) {
    salida.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0;color:#C4462B">
      Revisa el rango: la fecha inicial no puede ser posterior a la final.</p></section>`;
    return;
  }
  if (!navigator.onLine) {
    salida.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0;color:#C4462B">
      El tablero lee del servidor, así que necesita señal.</p></section>`;
    return;
  }

  estado.cargando = true;
  salida.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0">Consultando…</p></section>`;
  try {
    const [visitas, tiendas, marcas] = await Promise.all([
      listarVisitas(estado.cliente!.id, desde, hasta),
      listarTiendas(estado.cliente!.id, estado.admin ?? undefined),
      listarMarcas(estado.cliente!.id, estado.admin ?? undefined),
    ]);
    estado.visitas = visitas;
    estado.tiendas = tiendas;
    estado.marcas = marcas;
    estado.consultado = true;
    validarTodo();
    render();
  } catch (e) {
    salida.innerHTML = `<section class="bs-field"><p class="bs-hint" style="margin-left:0;color:#C4462B">
      No se pudo consultar: ${esc(e instanceof Error ? e.message : String(e))}</p></section>`;
  } finally {
    estado.cargando = false;
  }
}

// ---- pintado ----

function chipSenal(s: Senal): string {
  return `<span class="bs-senal is-${s.estado}">${esc(s.texto)}</span>`;
}

function filaVisita(v: VisitaHistorial): string {
  const senales = estado.senales.get(v.id) ?? [];
  const obs = aRevisar(senales);
  const gps =
    v.latitud != null && v.longitud != null
      ? `<a href="https://www.google.com/maps?q=${v.latitud},${v.longitud}" target="_blank"
           rel="noopener">${v.latitud.toFixed(4)}, ${v.longitud.toFixed(4)}</a>`
      : `<span style="color:#C4462B">sin gps</span>`;

  return `
    <article class="bs-row ${obs ? "is-observada" : ""}" style="grid-template-columns:1fr"><div>
      <div class="bs-row-name">${esc(v.tienda_nombre ?? "(sin nombre)")}
        ${obs ? `<span class="bs-obs">${obs} ${obs > 1 ? "observaciones" : "observación"}</span>` : ""}</div>
      <div class="bs-row-meta">No. ${esc(v.tienda_clave)} · ${esc(v.marca_nombre ?? "")} ·
        ${fmtFecha(v.capturada_en)} · ${esc(v.agente_nombre ?? "?")} · ${gps}</div>
      ${v.notas ? `<div class="bs-row-meta" style="color:#14181B">“${esc(v.notas)}”</div>` : ""}
      <div class="bs-senales">${senales.map(chipSenal).join("")}</div>
      <button class="bs-mini" data-fotos="${esc(v.id)}" style="margin-top:8px">Ver fotos</button>
      <!-- Sin id: la misma visita se pinta dos veces (en "piden revisión" y en
           "todas"), y dos elementos con el mismo id harían que el segundo nunca
           reciba sus fotos. verFotos() resuelve el contenedor por parentesco. -->
      <div class="bs-thumbs" style="margin-top:8px"></div>
    </div></article>`;
}

function render() {
  const salida = $("#t-salida")!;
  const vs = estado.visitas;

  if (vs.length === 0) {
    salida.innerHTML = `<div class="bs-empty">
      <p class="bs-empty-h">Sin visitas en ese periodo</p>
      <p class="bs-empty-p">Ojo: lo que un agente capturó y todavía no sube no aparece aquí —
      vive en su teléfono hasta que sincroniza.</p></div>`;
    return;
  }

  const visitadas = new Set(vs.map((v) => v.tienda_id));
  const cobertura = estado.tiendas.length
    ? Math.round((visitadas.size / estado.tiendas.length) * 100)
    : 0;
  const observadas = vs.filter((v) => aRevisar(estado.senales.get(v.id) ?? []) > 0);
  const porAgente = new Map<string, number>();
  for (const v of vs) {
    const k = v.agente_nombre ?? "(sin nombre)";
    porAgente.set(k, (porAgente.get(k) ?? 0) + 1);
  }

  const faltantes = estado.tiendas.filter((t) => !visitadas.has(t.id));

  salida.innerHTML = `
    <div class="bs-stats bs-stats-4">
      <div class="bs-stat"><div class="bs-stat-n">${vs.length}</div><div class="bs-stat-k">Visitas</div></div>
      <div class="bs-stat"><div class="bs-stat-n">${visitadas.size}</div>
        <div class="bs-stat-k">de ${estado.tiendas.length} tiendas · ${cobertura}%</div></div>
      <div class="bs-stat"><div class="bs-stat-n">${vs.reduce((s, v) => s + v.fotos, 0)}</div>
        <div class="bs-stat-k">Fotos</div></div>
      <div class="bs-stat"><div class="bs-stat-n${observadas.length ? " is-alerta" : ""}">${observadas.length}</div>
        <div class="bs-stat-k">Piden revisión</div></div>
    </div>
    <p class="bs-row-meta" style="padding:12px 0 0">
      ${[...porAgente.entries()].sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `${esc(n)}: ${c}`).join(" · ")}</p>

    ${
      observadas.length
        ? `<section class="bs-field">
             <div class="bs-legend"><span class="bs-num">02</span>
               <h2 class="bs-label">Piden revisión</h2></div>
             <p class="bs-hint">Una observación no quiere decir que la visita esté mal:
             quiere decir que alguien la mire. Cada una dice por qué.</p>
             <div class="bs-rows">${observadas.map(filaVisita).join("")}</div>
           </section>`
        : `<section class="bs-field">
             <div class="bs-legend"><span class="bs-num">02</span>
               <h2 class="bs-label">Piden revisión</h2></div>
             <p class="bs-hint">Ninguna visita del periodo tiene observaciones.</p>
           </section>`
    }

    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">03</span>
        <h2 class="bs-label">Todas las visitas</h2></div>
      <div class="bs-rows">${[...vs].map(filaVisita).join("")}</div>
    </section>

    <section class="bs-field">
      <div class="bs-legend"><span class="bs-num">04</span>
        <h2 class="bs-label">Cobertura</h2></div>
      <p class="bs-hint">${visitadas.size} de ${estado.tiendas.length} sucursales del catálogo
      recibieron visita en el periodo. Si el catálogo es el universo completo y no la ruta
      del mes, este porcentaje no es avance contra meta.</p>
      <div class="bs-inner">
        <button class="bs-mini" id="t-faltantes">Ver las ${faltantes.length} sin visitar</button>
        <div id="t-lista-faltantes" class="bs-faltantes"></div>
      </div>
    </section>

    <p class="bs-note">Las fotos no se descargan solas: cada una pesa unos 200 KB y se piden
    al tocar “Ver fotos”. La referencia de ubicación de cada tienda sale de las visitas del
    periodo consultado, no del catálogo — las 264 sucursales no tienen coordenadas
    oficiales todavía.</p>`;

  salida.querySelectorAll<HTMLButtonElement>("[data-fotos]").forEach((b) =>
    b.addEventListener("click", () => void verFotos(b))
  );
  $("#t-faltantes")?.addEventListener("click", () => {
    const c = $("#t-lista-faltantes")!;
    const btn = $("#t-faltantes")!;
    if (c.childElementCount) {
      c.innerHTML = "";
      btn.textContent = `Ver las ${faltantes.length} sin visitar`;
      return;
    }
    c.innerHTML = faltantes
      .map((t) => `<span class="bs-falta"><strong>${esc(t.clave_sucursal)}</strong> ${esc(t.nombre ?? "")}</span>`)
      .join("");
    btn.textContent = "Ocultar";
  });
}

async function verFotos(btn: HTMLButtonElement) {
  const id = btn.dataset.fotos!;
  // El mismo id puede estar dos veces en pantalla (en "piden revisión" y en
  // "todas"), así que se resuelve el contenedor que cuelga de ESTE botón.
  const cont = btn.parentElement?.querySelector<HTMLElement>(".bs-thumbs");
  if (!cont) return;
  if (cont.childElementCount) {
    cont.innerHTML = "";
    btn.textContent = "Ver fotos";
    return;
  }
  btn.textContent = "Cargando…";
  try {
    const fotos = await fotosDeVisita(id);
    cont.innerHTML = fotos
      .map((f) => `<a href="${f.url}" target="_blank" rel="noopener">
        <img class="bs-thumb" src="${f.url}" alt="${esc(f.tipo)}" loading="lazy"></a>`)
      .join("");
    btn.textContent = fotos.length ? "Ocultar fotos" : "Sin fotos";
  } catch {
    btn.textContent = "No se pudieron cargar";
  }
}

// ---- arranque ----

export async function init() {
  const root = document.getElementById("app");
  if (!root) return;

  const slug = slugDeLaUrl(location.pathname);
  if (!slug) {
    pantallaSimple(root, "Falta la<br>empresa",
      "Esta dirección necesita el nombre corto de la empresa: <strong>/&lt;empresa&gt;/panel</strong>.");
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
    cliente = await clientePorSlug(slug);
  } catch {
    pantallaSimple(root, "Sin conexión",
      "No se pudo leer la empresa desde el servidor. Revisa la señal y recarga.", true);
    return;
  }
  if (!cliente) {
    pantallaSimple(root, "Empresa<br>no encontrada",
      `No hay ninguna empresa activa con el nombre corto <strong>${esc(slug)}</strong>.`, true);
    return;
  }

  estado.cliente = cliente;
  montar(root);
}
