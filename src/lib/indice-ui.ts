// Índice de accesos: la portada del sitio.
//
// Hasta hoy `/` era la bienvenida de Astro. Quien abría la dirección a secas no
// llegaba a ningún lado y había que dictarle la ruta exacta por teléfono.
//
// LO QUE NO SE PONE AQUÍ
//
// Los tableros por empresa llevan el nombre del cliente en la liga
// (`/bikes-shot/panel`), y esta página es la raíz de un sitio público. Listarlos
// sin más publicaría a quién le trabajamos. Así que esos enlaces se pintan SOLO
// si en este dispositivo ya hay una identidad guardada y es de administrador.
//
// Es coherente con lo que ya hace el resto: la puerta no es una cerradura —con
// la RLS apagada, quien tenga la key publishable lee la base con o sin esta
// pantalla— pero no se regala la lista de clientes a quien pase por la
// dirección. La cerradura llega en fase 2.
//
// COSTO: si no hay identidad guardada, cero llamadas a la red. Si la hay, dos
// lecturas de catálogo de unos pocos KB, ambas cacheadas.

import { leerIdentidad } from "./identidad";
import { listarAgentes, listarClientes } from "./catalogo";
import { VERSION_APP } from "./rastro";
import type { Cliente } from "./tipos";

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/** Los tableros por empresa, si quien abre esta pantalla puede verlos. */
async function tablerosPermitidos(): Promise<
  { clientes: Cliente[]; nombre: string } | null
> {
  const id = leerIdentidad();
  if (!id) return null;

  const agente = (await listarAgentes()).find((a) => a.id === id.agente_id);
  if (!agente?.es_admin) return null;

  return { clientes: await listarClientes(agente), nombre: agente.nombre };
}

export async function init() {
  const destino = document.getElementById("accesos-empresa");
  if (!destino) return;

  let datos: Awaited<ReturnType<typeof tablerosPermitidos>> = null;
  try {
    datos = await tablerosPermitidos();
  } catch {
    // Sin señal y sin catálogo cacheado no se puede saber quién es: se deja el
    // texto de respaldo que ya está en el HTML. Nunca se rompe la página por
    // esto; los demás accesos tienen que seguir funcionando.
    return;
  }
  if (!datos || datos.clientes.length === 0) return;

  destino.innerHTML =
    `<p class="bs-hint" style="margin-left:0">Hola, ${esc(datos.nombre)}. Un tablero por empresa:</p>` +
    `<div class="bs-accesos">` +
    datos.clientes
      .map(
        (c) => `<a class="bs-acceso" href="/${esc(c.slug)}/panel">
          <span class="bs-acceso-t">${esc(c.nombre)}</span>
          <span class="bs-acceso-d">Cobertura, validación y visitas de esta empresa</span>
          <span class="bs-acceso-u">/${esc(c.slug)}/panel</span>
        </a>
        <a class="bs-acceso" href="/${esc(c.slug)}/tiendas">
          <span class="bs-acceso-t">${esc(c.nombre)} · tiendas</span>
          <span class="bs-acceso-d">Sus sucursales: cuáles se han visitado y cuáles
          no tienen coordenadas. Desde aquí se baja el CSV para cargarlas.</span>
          <span class="bs-acceso-u">/${esc(c.slug)}/tiendas</span>
        </a>`
      )
      .join("") +
    `</div>`;

  const pie = document.getElementById("indice-version");
  if (pie) pie.textContent = `app ${VERSION_APP}`;
}
