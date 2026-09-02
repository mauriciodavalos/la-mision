// Cuándo interrumpir al agente con un popup y cuándo no.
//
// La regla parece obvia hasta que se escribe: el popup es solo para el registro
// que el agente acaba de guardar y está esperando. Si al volver la señal se
// confirman tres visitas viejas mientras está tomando fotos de la cuarta, un
// popup ahí interrumpe la captura — que es lo único que no puede fallar.

export async function correr(
  { decidirAviso, textoOtrasSubidas, textoPendientesAlSalir, LIMITE_ESPERA_MS },
  check
) {
  const mia = { id: "visita-a", desde: Date.now() };
  const vacio = { subidas: [], errores: [] };

  // 1) El caso que motivó todo: el agente acaba de guardar y su visita sube.
  check(
    decidirAviso(mia, { subidas: ["visita-a"], errores: [] }).tipo === "propia-subida",
    "la visita que el agente espera sube: popup de confirmación"
  );

  // 2) Falla la suya: también popup, pero NUNCA como pérdida.
  const fallo = decidirAviso(mia, {
    subidas: [],
    errores: [{ id: "visita-a", error: "Storage: timeout" }],
  });
  check(fallo.tipo === "propia-fallo", "si falla la suya, se le dice");
  check(
    fallo.error === "Storage: timeout",
    "el motivo real del fallo llega a la pantalla, no un mensaje genérico"
  );

  // 3) Confirmaciones tardías con el agente ya en otra captura: aviso discreto.
  const tardias = decidirAviso(mia, { subidas: ["vieja-1", "vieja-2"], errores: [] });
  check(
    tardias.tipo === "otras-subidas" && tardias.cuantas === 2,
    "las visitas viejas que suben NO abren popup: interrumpirían la captura en curso"
  );

  // 4) Sin nada que esperar (la app recién abierta sube la cola sola).
  const sinEspera = decidirAviso(null, { subidas: ["vieja-1"], errores: [] });
  check(
    sinEspera.tipo === "otras-subidas" && sinEspera.cuantas === 1,
    "sin visita en espera, una subida sigue avisándose discretamente"
  );

  // 5) Un fallo de otra visita no puede robarle el popup a la que se espera.
  check(
    decidirAviso(mia, { subidas: [], errores: [{ id: "otra", error: "x" }] }).tipo === "nada",
    "el fallo de OTRA visita no interrumpe al agente"
  );
  check(decidirAviso(mia, vacio).tipo === "nada", "un evento sin novedades no avisa nada");

  // 6) La visita propia se cuenta una sola vez: ni popup y aviso discreto juntos.
  const mixto = decidirAviso(mia, { subidas: ["visita-a", "vieja-1"], errores: [] });
  check(
    mixto.tipo === "propia-subida",
    "si en la misma pasada sube la suya y otra, gana el popup de la suya"
  );

  // 7) Plurales: se leen en el teléfono, valen la pena.
  check(textoOtrasSubidas(1).startsWith("1 registro subido"), "singular correcto");
  check(textoOtrasSubidas(3).startsWith("3 registros subidos"), "plural correcto");

  // 8) Aviso al cerrar la app: solo si de verdad hay evidencia colgada.
  check(textoPendientesAlSalir(0) === null, "sin pendientes no se estorba al cerrar");
  check(
    (textoPendientesAlSalir(1) ?? "").includes("Queda 1 registro"),
    "con uno pendiente avisa al cerrar"
  );
  check(
    (textoPendientesAlSalir(4) ?? "").includes("Quedan 4 registros"),
    "con varios pendientes avisa al cerrar"
  );

  // 9) La espera tiene tope: nadie se queda mirando una rueda dentro de una tienda.
  check(
    LIMITE_ESPERA_MS > 0 && LIMITE_ESPERA_MS <= 15000,
    `el popup deja de esperar en un tiempo razonable (${LIMITE_ESPERA_MS} ms)`
  );
}
