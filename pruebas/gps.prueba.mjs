// Ubicación obligatoria: que se pueda exigir sin dejar a un agente sin capturar.
// Simula el geolocation del navegador (ver correr.mjs).

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

const error = (code) => ({ code, PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT });
const posicion = (lat, lng, precision) => ({
  coords: { latitude: lat, longitude: lng, accuracy: precision },
  timestamp: Date.now(),
});

export async function correr({ obtenerUbicacion, iniciarSeguimiento }, check) {
  let llamadas = [];
  let watchLimpio = null;

  function montar(handler) {
    llamadas = [];
    const nav = {
      geolocation: {
        getCurrentPosition(ok, fail, opts) {
          llamadas.push(opts);
          handler(ok, fail, llamadas.length);
        },
        watchPosition(ok, fail, opts) {
          llamadas.push(opts);
          handler(ok, fail, llamadas.length);
          return 7;
        },
        clearWatch(id) {
          watchLimpio = id;
        },
      },
    };
    // Node define `navigator` como getter: hay que redefinir la propiedad.
    Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  }

  // 1) Si la alta precisión se agota, debe haber una segunda etapa más tolerante.
  montar((ok, fail, n) => (n === 1 ? fail(error(TIMEOUT)) : ok(posicion(19.4, -99.1, 850))));
  let r = await obtenerUbicacion();
  check(llamadas.length === 2, "tras un timeout hace un segundo intento");
  check(
    llamadas[0].enableHighAccuracy === true && llamadas[1].enableHighAccuracy === false,
    "la segunda etapa va sin alta precisión (usa red y última posición conocida)"
  );
  check(
    r.ok && r.ubicacion.precision === 850,
    "acepta una lectura imprecisa (± 850 m) en vez de quedarse sin nada"
  );

  // 2) Con el permiso bloqueado, insistir solo hace esperar.
  montar((ok, fail) => fail(error(PERMISSION_DENIED)));
  r = await obtenerUbicacion();
  check(llamadas.length === 1, "con el permiso bloqueado no insiste");
  check(!r.ok && r.motivo === "permiso", "reporta el motivo 'permiso', no un nulo mudo");

  // 3) Los motivos se distinguen: cada uno lleva una instrucción distinta.
  montar((ok, fail) => fail(error(POSITION_UNAVAILABLE)));
  r = await obtenerUbicacion();
  check(!r.ok && r.motivo === "no_disponible", "distingue 'no disponible' de 'timeout'");

  // 4) El seguimiento se queda con la mejor lectura, no con la última.
  const vistas = [];
  montar((ok) => {
    ok(posicion(19.4, -99.1, 500));
    ok(posicion(19.41, -99.11, 40));
    ok(posicion(19.42, -99.12, 900));
  });
  const detener = iniciarSeguimiento((u) => vistas.push(u.precision));
  check(
    JSON.stringify(vistas) === "[500,40]",
    "el seguimiento conserva la mejor lectura (500 → 40) e ignora la peor (900)"
  );
  detener();
  check(watchLimpio === 7, "detener el seguimiento libera el watch (batería)");
}
