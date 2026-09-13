// De la URL a la empresa y la sección.
//
// Vive aparte de la pantalla porque no es presentación: es la decisión de QUÉ
// EMPRESA se va a mostrar. Si esto se equivoca, se enseñan los datos de un
// cliente bajo el nombre de otro — la única cosa que el proyecto no puede hacer
// nunca. Aparte, así se puede probar sin navegador.

/** Las páginas que cuelgan de una empresa. Una ruta con cualquier otra palabra
 *  no se interpreta: es preferible un 404 a abrir algo que no se pidió. */
export const SECCIONES = ["panel", "tiendas"] as const;
export type Seccion = (typeof SECCIONES)[number];

export interface RutaEmpresa {
  slug: string;
  seccion: Seccion;
}

// Mismo alfabeto que produce `slugify()` en 0005_slugs.sql.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `/bikes-shot/panel` -> `{ slug: "bikes-shot", seccion: "panel" }`.
 * Devuelve null si la ruta no tiene esa forma, y la página lo dice en vez de
 * adivinar una empresa.
 *
 * Se lee del path y no de un parámetro (`?empresa=`) para que la dirección se
 * pueda dictar por teléfono sin explicar un signo de interrogación.
 */
export function rutaDeEmpresa(ruta: string): RutaEmpresa | null {
  const partes = ruta.split("/").filter(Boolean);
  if (partes.length !== 2) return null;

  const slug = partes[0].toLowerCase();
  const seccion = partes[1];
  if (!SLUG.test(slug)) return null;
  if (!(SECCIONES as readonly string[]).includes(seccion)) return null;

  return { slug, seccion: seccion as Seccion };
}

/** Solo el slug, para quien no necesita saber la sección. */
export function slugDeLaUrl(ruta: string): string | null {
  return rutaDeEmpresa(ruta)?.slug ?? null;
}
