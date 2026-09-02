// El rastro es lo que decide qué arreglo aplica cuando un teléfono se cae.
// Si se equivoca al clasificar una caída, la app activa el modo de cámara
// equivocado y el agente sigue sin poder capturar. Se simula localStorage.

export async function correr(
  { marcar, cerrar, revisarCaida, murioEnLaCamara, listarCaidas, olvidarCaidas, comoTexto },
  check
) {
  function montarAlmacen({ falla = false } = {}) {
    const datos = new Map();
    const ls = {
      getItem: (k) => (datos.has(k) ? datos.get(k) : null),
      setItem: (k, v) => {
        if (falla) throw new Error("QuotaExceededError");
        datos.set(k, v);
      },
      removeItem: (k) => datos.delete(k),
    };
    Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
    Object.defineProperty(globalThis, "screen", {
      value: { width: 412, height: 915 },
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Android 13 Chrome/140", deviceMemory: 2 },
      configurable: true,
    });
    return datos;
  }

  // 1) Un flujo que termina bien no deja caída.
  montarAlmacen();
  marcar("camara-abierta", "anaquel");
  marcar("archivo-recibido", "4200000 bytes");
  marcar("comprimido");
  cerrar();
  check(revisarCaida() === null, "una foto que llegó completa no se reporta como caída");

  // 2) La caída de Romina: el rastro se corta en la cámara del sistema.
  //    Este es el caso que NO se arregla comprimiendo mejor.
  montarAlmacen();
  marcar("camara-abierta", "anaquel");
  let c = revisarCaida();
  check(c !== null, "un rastro sin cerrar se reporta como caída");
  check(
    murioEnLaCamara(c),
    "la caída con la cámara del sistema abierta se distingue: ahí la app ni corrió"
  );

  // 3) Caída procesando la foto: sí es nuestra compresión.
  montarAlmacen();
  marcar("camara-abierta");
  marcar("archivo-recibido", "4200000 bytes");
  marcar("decodificando", "respaldo: sin escalado nativo");
  c = revisarCaida();
  check(
    !murioEnLaCamara(c),
    "una caída al decodificar NO se confunde con la de la cámara del sistema"
  );
  check(
    comoTexto(c).includes("respaldo: sin escalado nativo"),
    "el detalle del paso llega al reporte: dice si se usó el camino escalado o el respaldo"
  );
  check(
    comoTexto(c).includes("Android 13 Chrome/140") && comoTexto(c).includes("RAM ~2 GB"),
    "el reporte identifica el teléfono: sin eso no se sabe de dónde vino la caída"
  );

  // 4) Revisar una caída la limpia: no puede reportarse dos veces al abrir.
  check(revisarCaida() === null, "leer la caída limpia el rastro: no se repite el aviso");
  // (Solo una: cada montarAlmacen() arranca con el teléfono en blanco.)
  check(listarCaidas().length === 1, "la caída queda archivada para verla después");
  olvidarCaidas();
  check(listarCaidas().length === 0, "se pueden olvidar cuando ya se atendieron");

  // 5) Sin localStorage (modo privado de iOS) NO puede tronar la captura.
  montarAlmacen({ falla: true });
  let reventó = false;
  try {
    marcar("camara-abierta");
    revisarCaida();
  } catch {
    reventó = true;
  }
  check(!reventó, "si localStorage falla, la captura sigue: el rastro nunca estorba");
}
