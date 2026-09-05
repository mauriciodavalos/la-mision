// Corregir la tienda de una visita ya sincronizada.
//
// Lo que se prueba aquí no se puede probar a mano: son las reglas que impiden
// que arreglar un dato rompa otro. La que motivó la suite es `cadena_id` —
// `visitas` la guarda aparte de `tienda_id` y ninguna llave foránea obliga a que
// coincidan, así que mover solo la tienda deja la visita diciendo que ocurrió en
// una cadena donde esa sucursal no existe. Es un error silencioso: no truena
// nada, y el reporte por cadena queda mal para siempre.

export async function correr(
  { prepararCorreccionTienda, historialDeCorrecciones, LLAVE_CORRECCIONES },
  check
) {
  const visita = {
    id: "visita-1",
    cliente_id: "cli-davalos",
    tienda_id: "t-1075",
    cadena_id: "cad-sanborns",
    tienda_clave: "1075",
    tienda_nombre: "CENTRO INSURGENTES",
    datos: { piezas_exhibidas: 4 },
  };
  const destino = {
    id: "t-1006",
    cliente_id: "cli-davalos",
    cadena_id: "cad-sanborns",
    clave_sucursal: "1006",
    nombre: "INSURGENTES",
  };
  const cuando = new Date("2026-09-04T21:49:07.411Z");

  // 1) El caso real: Carmen eligió 1075 y era 1006.
  const p = prepararCorreccionTienda(visita, destino, "Mau", "  la agente lo reportó  ", cuando);
  check(p.ok === true, "una tienda distinta del mismo cliente sí se puede corregir");
  check(p.ok && p.cambios.tienda_id === "t-1006", "la visita queda apuntando a la tienda nueva");

  // 2) La regla que motivó todo.
  check(
    p.ok && p.cambios.cadena_id === "cad-sanborns",
    "la cadena se toma SIEMPRE de la tienda destino, no se deja la vieja"
  );
  const otraCadena = prepararCorreccionTienda(
    visita,
    { ...destino, cadena_id: "cad-walmart" },
    "Mau",
    undefined,
    cuando
  );
  check(
    otraCadena.ok && otraCadena.cambios.cadena_id === "cad-walmart",
    "si la tienda destino es de otra cadena, la visita se mueve con ella"
  );

  // 3) No se reescribe en silencio: queda el rastro, con claves legibles.
  const h = historialDeCorrecciones(p.ok ? p.cambios.datos : {});
  check(h.length === 1, "la corrección deja un renglón en el historial");
  check(
    h[0].de === "t-1075" && h[0].a === "t-1006",
    "el rastro guarda de qué tienda a qué tienda"
  );
  check(
    h[0].de_clave === "1075" && h[0].a_clave === "1006",
    "guarda también las claves de sucursal: el rastro se lee sin cruzar UUIDs"
  );
  check(h[0].por === "Mau", "queda quién la hizo");
  check(h[0].en === cuando.toISOString(), "y cuándo, en UTC");
  check(h[0].motivo === "la agente lo reportó", "el motivo se guarda sin espacios de sobra");

  // 4) Lo que ya traía `datos` no se pierde: ahí viven las respuestas de los
  //    campos configurables de la marca.
  check(
    p.ok && p.cambios.datos.piezas_exhibidas === 4,
    "los campos capturados por la agente sobreviven a la corrección"
  );

  // 5) Un motivo vacío no ensucia el rastro con una llave sin valor.
  const sinMotivo = prepararCorreccionTienda(visita, destino, "Mau", "   ", cuando);
  check(
    sinMotivo.ok && !("motivo" in historialDeCorrecciones(sinMotivo.cambios.datos)[0]),
    "sin motivo escrito, no se inventa uno"
  );

  // 6) Corregir dos veces acumula, no pisa: si alguien se equivoca al corregir,
  //    el intento anterior tiene que seguir visible.
  const segunda = prepararCorreccionTienda(
    {
      ...visita,
      tienda_id: "t-1006",
      tienda_clave: "1006",
      datos: p.ok ? p.cambios.datos : {},
    },
    { ...destino, id: "t-1011", clave_sucursal: "1011", nombre: "PLAZA UNIVERSIDAD" },
    "Mau",
    undefined,
    cuando
  );
  const h2 = historialDeCorrecciones(segunda.ok ? segunda.cambios.datos : {});
  check(h2.length === 2, "una segunda corrección se suma al historial, no lo reemplaza");
  check(h2[0].a === "t-1006" && h2[1].a === "t-1011", "el historial queda en orden");

  // 7) Aislamiento multi-cliente: se verifica en código, no se confía en que la
  //    búsqueda ya filtró. En fase 1 no hay RLS que lo detenga después.
  const ajena = prepararCorreccionTienda(
    visita,
    { ...destino, cliente_id: "cli-bikes-shot" },
    "Mau",
    undefined,
    cuando
  );
  check(!ajena.ok, "una visita NUNCA se mueve a la tienda de otra empresa");

  // 8) Mover a la misma tienda no es una corrección: sería un renglón de rastro
  //    que no explica nada.
  const misma = prepararCorreccionTienda(
    visita,
    { ...destino, id: "t-1075", cadena_id: "cad-sanborns" },
    "Mau",
    undefined,
    cuando
  );
  check(!misma.ok, "elegir la tienda que ya tenía no escribe nada");

  // 9) La llave del rastro vive en el espacio de la app, no en el de la marca.
  check(
    LLAVE_CORRECCIONES.startsWith("_"),
    "el historial usa una llave con guion bajo: no choca con los campos configurables"
  );
  check(
    historialDeCorrecciones(undefined).length === 0 &&
      historialDeCorrecciones({}).length === 0 &&
      historialDeCorrecciones({ [LLAVE_CORRECCIONES]: "basura" }).length === 0,
    "una visita sin correcciones —o con el campo corrupto— devuelve lista vacía"
  );
}
