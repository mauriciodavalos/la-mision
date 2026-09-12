// De la URL al slug de la empresa.
//
// Vive aparte de la pantalla porque no es presentación: es la decisión de QUÉ
// EMPRESA se va a mostrar. Si esto se equivoca, el tablero enseña los datos de
// un cliente bajo el nombre de otro — la única cosa que el proyecto no puede
// hacer nunca. Aparte, así se puede probar sin navegador.

/**
 * `/bikes-shot/panel` -> `"bikes-shot"`. Devuelve null si la ruta no tiene esa
 * forma, y la página lo dice en vez de adivinar una empresa.
 *
 * Se lee del path y no de un parámetro (`?empresa=`) para que la dirección se
 * pueda dictar por teléfono sin explicar un signo de interrogación.
 */
export function slugDeLaUrl(ruta: string): string | null {
  const partes = ruta.split("/").filter(Boolean);
  if (partes.length !== 2 || partes[1] !== "panel") return null;

  const slug = partes[0].toLowerCase();
  // Mismo alfabeto que produce `slugify()` en 0005_slugs.sql. Se valida aquí y
  // no se confía en la consulta: un segmento raro no tiene por qué llegar a la
  // base, y un `..` o un `%2F` no tienen nada que hacer en un identificador.
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}
