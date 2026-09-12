// Señales de validación de una visita.
//
// Lo que de verdad se prueba aquí es la honestidad del semáforo. Un tablero que
// pinta verde donde no tiene información es peor que no tener tablero: enseña a
// confiar en una luz que no está midiendo nada. Por eso la mitad de estas
// comprobaciones verifican que el resultado sea "sin-referencia" y NO "ok".

export async function correr(
  { validar, puntoDeReferencia, metrosEntre, aRevisar, lapso, LIMITE_DISTANCIA_M, LIMITE_KMH },
  check
) {
  // Sanborns Galerías Insurgentes, coordenadas reales del piloto.
  const BASE = { lat: 19.37102, lng: -99.17832 };
  const visita = (extra = {}) => ({
    id: "v1", capturada_en: "2026-09-12T18:00:00.000Z",
    latitud: BASE.lat, longitud: BASE.lng, precision_gps: 12,
    agente_id: "ag1", tienda_id: "t1", marca_id: "m1", fotos: 2, correcciones: 0,
    ...extra,
  });
  const ctxBase = { referencia: null, anterior: null, fotosEsperadas: 2, otrasDelDia: 0 };
  const de = (senales, clave) => senales.find((s) => s.clave === clave);

  // ---- el punto de referencia ----

  // Mediana y no promedio: una lectura mala no debe arrastrar la referencia de
  // la tienda, porque entonces la visita mala se valida a sí misma.
  const conOutlier = [
    visita({ latitud: 19.371, longitud: -99.1783 }),
    visita({ latitud: 19.3711, longitud: -99.1784 }),
    visita({ latitud: 19.5, longitud: -99.4 }), // una lectura disparatada
  ];
  const ref = puntoDeReferencia(conOutlier);
  check(
    metrosEntre(ref.lat, ref.lng, 19.3711, -99.1784) < 20,
    "la referencia usa la mediana: una lectura disparatada no la mueve"
  );
  check(ref.oficial === false, "sin catálogo, la referencia se marca como NO oficial");

  // El catálogo manda cuando existe: es la única referencia independiente.
  const oficial = puntoDeReferencia(conOutlier, { lat: 19.37102, lng: -99.17832 });
  check(oficial.oficial === true, "si el catálogo trae coordenadas, esas ganan");
  check(puntoDeReferencia([], null) === null, "sin visitas ni catálogo no hay referencia");
  check(
    puntoDeReferencia([visita({ latitud: null, longitud: null })]) === null,
    "visitas sin coordenadas no producen referencia"
  );

  // ---- ubicación ----

  // LA comprobación que justifica el módulo: con una sola visita, compararla
  // contra una referencia hecha con ella misma da 0 m — un verde vacío.
  const sola = [visita()];
  const unaSola = validar(sola[0], { ...ctxBase, referencia: puntoDeReferencia(sola) });
  check(
    de(unaSola, "ubicacion").estado === "sin-referencia",
    "una tienda con una sola visita NO se valida: diría 0 m siempre"
  );

  // Con referencia oficial sí se valida aunque haya una sola visita: la
  // referencia es independiente de la visita.
  const conOficial = validar(sola[0], {
    ...ctxBase,
    referencia: puntoDeReferencia(sola, { lat: BASE.lat, lng: BASE.lng }),
  });
  check(
    de(conOficial, "ubicacion").estado === "ok",
    "con coordenadas oficiales, una sola visita sí se puede validar"
  );

  const dos = [visita(), visita({ id: "v2" })];
  const r2 = puntoDeReferencia(dos);
  check(de(validar(dos[0], { ...ctxBase, referencia: r2 }), "ubicacion").estado === "ok",
    "una visita que coincide con las demás pasa");

  // ~1.4 km al norte: fuera de cualquier plaza.
  const lejos = visita({ latitud: BASE.lat + 0.0125, longitud: BASE.lng });
  const sLejos = validar(lejos, { ...ctxBase, referencia: r2 });
  check(de(sLejos, "ubicacion").estado === "revisar", "una visita lejos de la referencia se marca");
  check(
    /\d+ m de las otras visitas/.test(de(sLejos, "ubicacion").texto),
    "el texto dice la distancia y contra qué se comparó, no solo 'sospechosa'"
  );

  // El límite no se pasa con el ancho de una plaza comercial.
  const enLaPlaza = visita({ latitud: BASE.lat + 0.0018, longitud: BASE.lng }); // ~200 m
  check(
    de(validar(enLaPlaza, { ...ctxBase, referencia: r2 }), "ubicacion").estado === "ok",
    `moverse dentro de una plaza (~200 m) no dispara la alerta (límite ${LIMITE_DISTANCIA_M} m)`
  );

  check(
    de(validar(visita({ latitud: null, longitud: null }), { ...ctxBase, referencia: r2 }), "ubicacion")
      .estado === "revisar",
    "una visita sin coordenadas se marca para revisar, no se ignora"
  );

  // ---- precisión ----
  check(de(validar(visita({ precision_gps: 12 }), ctxBase), "precision").estado === "ok",
    "±12 m es una lectura buena");
  check(de(validar(visita({ precision_gps: 900 }), ctxBase), "precision").estado === "revisar",
    "±900 m no ubica dentro de una plaza: se marca");
  check(
    de(validar(visita({ precision_gps: null }), ctxBase), "precision").estado === "sin-referencia",
    "las 82 visitas viejas no traen precisión: eso es 'sin dato', NO 'ok'"
  );

  // ---- saltos imposibles ----
  const previa = visita({ id: "v0", capturada_en: "2026-09-12T17:30:00.000Z" });
  check(
    de(validar(visita(), { ...ctxBase, anterior: previa }), "salto").estado === "ok",
    "dos visitas cercanas seguidas no son un salto"
  );
  // Acapulco (~300 km) media hora después de CDMX.
  const teletransporte = visita({ latitud: 16.8531, longitud: -99.8237 });
  const sSalto = validar(teletransporte, { ...ctxBase, anterior: previa });
  check(de(sSalto, "salto").estado === "revisar", `300 km en 30 min supera ${LIMITE_KMH} km/h: se marca`);
  check(/km\/h/.test(de(sSalto, "salto").texto), "cuando marca, el texto dice la velocidad implícita");

  // El mismo viaje con tiempo suficiente es normal: Mau fue a Acapulco de verdad.
  const enCoche = visita({ latitud: 16.8531, longitud: -99.8237, capturada_en: "2026-09-13T04:00:00.000Z" });
  const sCoche = de(validar(enCoche, { ...ctxBase, anterior: previa }), "salto");
  check(sCoche.estado === "ok", "el mismo recorrido con horas de por medio NO se marca: viajar es normal");
  // Salió del tablero real: "20 km desde la anterior (0 km/h)" se lee como una
  // falla del sistema y hace dudar del resto de las señales.
  check(
    !/km\/h/.test(sCoche.texto) && /después/.test(sCoche.texto),
    "cuando no marca, el texto dice cuánto tiempo pasó y NO una velocidad de 0 km/h"
  );
  check(lapso(1800) === "30 min" && lapso(7200) === "2 h" && lapso(259200) === "3 días",
    "el lapso se escribe en la unidad que se lee de un vistazo");
  check(
    de(validar(visita(), { ...ctxBase, anterior: null }), "salto").estado === "sin-referencia",
    "la primera visita del agente no tiene con qué comparar"
  );
  // Reloj del teléfono en desorden: sin tiempo no hay velocidad.
  const alReves = visita({ latitud: 16.8531, longitud: -99.8237, capturada_en: "2026-09-12T17:00:00.000Z" });
  check(
    de(validar(alReves, { ...ctxBase, anterior: previa }), "salto").estado === "revisar",
    "capturas fuera de orden se marcan en vez de dar una velocidad negativa"
  );

  // ---- evidencia, duplicados y correcciones ----
  check(de(validar(visita({ fotos: 1 }), ctxBase), "evidencia").estado === "revisar",
    "una visita con menos fotos de las que pide la marca se marca");
  check(de(validar(visita({ fotos: 3 }), { ...ctxBase, fotosEsperadas: 2 }), "evidencia").estado === "ok",
    "fotos de más no son falta");
  check(!de(validar(visita(), ctxBase), "duplicada"), "sin otra ese día, no se habla de duplicados");
  check(de(validar(visita(), { ...ctxBase, otrasDelDia: 1 }), "duplicada").estado === "revisar",
    "otra visita a la misma tienda y marca ese día se señala");
  check(de(validar(visita({ correcciones: 1 }), ctxBase), "corregida").estado === "revisar",
    "una visita corregida a mano se declara: la fila no es la original");

  // ---- conteo ----
  const limpia = validar(visita(), { ...ctxBase, referencia: r2, anterior: previa });
  check(aRevisar(limpia) === 0, "una visita sana no acumula observaciones");
  const sucia = validar(visita({ fotos: 0, precision_gps: 900, correcciones: 2 }), {
    ...ctxBase, referencia: r2, otrasDelDia: 1,
  });
  check(aRevisar(sucia) === 4, "se cuentan todas las observaciones, no solo la primera");
}
