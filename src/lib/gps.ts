// Lectura de GPS del dispositivo.
//
// La ubicación es OBLIGATORIA para guardar una visita (ver faltantes() en
// captura-ui.ts). Una foto de exhibición sin coordenadas no se puede auditar:
// no hay forma de saber que se tomó en la tienda que dice.
//
// Por eso este módulo no se limita a pedir la posición una vez y rendirse — que
// es lo que hacía antes, con 8 segundos de alta precisión y un `null` en
// silencio si fallaba. El primer día en campo eso dejó visitas sin coordenadas
// (31 ago). Ahora:
//
//  1. SEGUIMIENTO CONTINUO mientras dura la captura (watchPosition). El GPS tiene
//     toda la visita para fijar posición, no ocho segundos al final. Se conserva
//     la mejor lectura, no la última.
//  2. DOS ETAPAS al pedirla a mano: primero alta precisión; si eso no contesta,
//     un segundo intento SIN alta precisión, que usa red y última posición
//     conocida. Bajo el techo de una tienda esa segunda etapa es la que responde.
//  3. MOTIVO DEL FALLO, para poder decirle al agente qué hacer. No es lo mismo
//     "el permiso está bloqueado en Ajustes" que "todavía no fija".
//
// Nada de esto depende de la red: el GPS es hardware del teléfono. La segunda
// etapa aprovecha la red si la hay, pero no la necesita.

export interface Ubicacion {
  lat: number;
  lng: number;
  precision: number; // metros
  medida_en: number; // Date.now() de la lectura
}

export type MotivoGps = "sin_soporte" | "permiso" | "no_disponible" | "timeout";

export type ResultadoGps =
  | { ok: true; ubicacion: Ubicacion }
  | { ok: false; motivo: MotivoGps };

// Una lectura más vieja que esto ya no representa dónde está el agente ahora.
const VIGENCIA_MS = 2 * 60 * 1000;

const ALTA: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 30000,
};

// Segunda etapa: sin alta precisión el sistema puede contestar con la posición
// de red o la última conocida. Menos exacta, pero una lectura de ±500 m es
// infinitamente mejor que ninguna — y con GPS obligatorio, la diferencia entre
// que la agente pueda capturar o no.
const BAJA: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10000,
  maximumAge: 300000,
};

function aUbicacion(p: GeolocationPosition): Ubicacion {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    precision: Math.round(p.coords.accuracy),
    medida_en: p.timestamp || Date.now(),
  };
}

function motivoDe(e: GeolocationPositionError): MotivoGps {
  if (e.code === e.PERMISSION_DENIED) return "permiso";
  if (e.code === e.POSITION_UNAVAILABLE) return "no_disponible";
  return "timeout";
}

function unTiro(opciones: PositionOptions): Promise<ResultadoGps> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ ok: true, ubicacion: aUbicacion(p) }),
      (e) => resolve({ ok: false, motivo: motivoDe(e) }),
      opciones
    );
  });
}

// Pide la ubicación con las dos etapas. Se llama al montar el formulario y cada
// vez que el agente toca "Reintentar ubicación" — ese toque, además, es el gesto
// del usuario que iOS exige para volver a preguntar por el permiso.
export async function obtenerUbicacion(): Promise<ResultadoGps> {
  if (!("geolocation" in navigator)) return { ok: false, motivo: "sin_soporte" };

  const alta = await unTiro(ALTA);
  if (alta.ok) return alta;

  // Con el permiso bloqueado, insistir no sirve: el segundo intento falla igual
  // y solo hace esperar. Lo que hace falta es que el agente lo active.
  if (alta.motivo === "permiso") return alta;

  return unTiro(BAJA);
}

// Seguimiento continuo mientras el agente llena el formulario. Llama a `alLeer`
// cada vez que consigue una posición MEJOR que la que ya tenía (más precisa, o
// simplemente más nueva que la anterior si aquella ya venció).
//
// Devuelve la función para detenerlo: hay que llamarla al guardar o al salir,
// porque un watch vivo mantiene el GPS despierto y gasta batería.
export function iniciarSeguimiento(
  alLeer: (u: Ubicacion) => void,
  alFallar?: (m: MotivoGps) => void
): () => void {
  if (!("geolocation" in navigator)) {
    alFallar?.("sin_soporte");
    return () => undefined;
  }

  let mejor: Ubicacion | null = null;

  const id = navigator.geolocation.watchPosition(
    (p) => {
      const u = aUbicacion(p);
      const venció = mejor !== null && Date.now() - mejor.medida_en > VIGENCIA_MS;
      if (!mejor || venció || u.precision <= mejor.precision) {
        mejor = u;
        alLeer(u);
      }
    },
    (e) => alFallar?.(motivoDe(e)),
    ALTA
  );

  return () => navigator.geolocation.clearWatch(id);
}

// Estado del permiso, cuando el navegador lo sabe decir. Sirve para explicarle al
// agente por qué no hay ubicación antes de que se quede esperando.
// Safari viejo no soporta la consulta para geolocation: ahí devuelve "desconocido".
export async function estadoPermiso(): Promise<
  "granted" | "denied" | "prompt" | "desconocido"
> {
  try {
    const p = await navigator.permissions?.query({
      name: "geolocation" as PermissionName,
    });
    return (p?.state as "granted" | "denied" | "prompt") ?? "desconocido";
  } catch {
    return "desconocido";
  }
}

// Pasos para reactivar el permiso, SOLO los del teléfono que tiene el agente.
//
// No se puede volver a pedir el permiso desde el código: cuando el navegador
// guarda un "bloquear" para el sitio, `getCurrentPosition()` responde
// PERMISSION_DENIED de inmediato, sin mostrar diálogo, y no hay API para
// revocarlo. Lo único que queda es decirle al agente exactamente dónde tocar.
//
// Por eso van separados por plataforma en vez del párrafo que mezclaba los dos:
// adentro de una tienda, con prisa, leer instrucciones de un teléfono que no es
// el tuyo para encontrar las tuyas es la diferencia entre resolverlo y no.
export function instruccionesPermiso(): string[] {
  const ua = navigator.userAgent;
  const esIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);

  if (esIOS) {
    return [
      "Ajustes → Privacidad y seguridad → Localización: que esté encendida.",
      "En esa misma lista busca Safari y elige «Al usar la app».",
      "Ajustes → Safari → Ubicación: elige «Preguntar» o «Permitir».",
      "Vuelve a esta pantalla y toca «Ya lo activé».",
    ];
  }
  return [
    "Baja la cortinilla del teléfono y revisa que la Ubicación esté encendida.",
    "En Chrome, toca los tres puntos (⋮) → Configuración → Configuración de sitios → Ubicación.",
    "Busca este sitio en la lista de bloqueados y cámbialo a Permitir.",
    "Vuelve a esta pantalla y toca «Ya lo activé».",
  ];
}

// Qué hacer, en palabras del agente, según por qué falló.
export function explicar(motivo: MotivoGps): string {
  switch (motivo) {
    case "permiso":
      return (
        "La ubicación está bloqueada para esta app. En iPhone: Ajustes → Safari → " +
        "Ubicación → Preguntar o Permitir, y también Ajustes → Privacidad → " +
        "Localización. En Android: mantén presionado el ícono de la app → " +
        "Información → Permisos → Ubicación. Después vuelve a tocar Reintentar."
      );
    case "no_disponible":
      return (
        "El teléfono no logra ubicarte. Revisa que la ubicación del sistema esté " +
        "encendida y, si estás en un sótano o pasillo cerrado, acércate a la " +
        "entrada o a una ventana y toca Reintentar."
      );
    case "timeout":
      return (
        "Tardó demasiado en encontrar la señal. Adentro de la tienda es normal: " +
        "espera unos segundos más o acércate a la entrada, y toca Reintentar."
      );
    case "sin_soporte":
      return "Este navegador no puede dar la ubicación. Abre la app en Chrome o Safari.";
  }
}
