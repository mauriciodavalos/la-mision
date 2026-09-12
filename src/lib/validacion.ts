// Señales de validación de una visita, para el tablero por cliente.
//
// QUÉ ES Y QUÉ NO ES
//
// Esto NO detecta una ubicación falsa. No se puede desde la web: la API de
// geolocalización del navegador no dice si el fix vino de un proveedor simulado
// —Android sí lo sabe (isFromMockProvider), pero Chrome no se lo pasa a la
// página—, así que cualquier promesa de "detectamos GPS falso" en una PWA es
// heurística, no la bandera.
//
// Lo que sí se puede es medir PLAUSIBILIDAD con lo que ya guardamos, y decirlo
// con esa palabra. Cada señal contesta una pregunta concreta y responde una de
// tres cosas: está bien, hay que revisarla, o no hay con qué compararla. Esa
// tercera respuesta es la importante: un tablero que pinta verde donde no tiene
// información es peor que no tener tablero, porque enseña a confiar en un
// semáforo que no está midiendo nada.
//
// EL PUNTO DE REFERENCIA DE CADA TIENDA
//
// Las 264 sucursales del catálogo tienen latitud/longitud en NULL: los CSV de
// origen no las traen. Así que el punto se saca de las propias visitas, con la
// MEDIANA de las lecturas (no el promedio: una sola lectura mala arrastra el
// promedio y no mueve la mediana).
//
// Eso obliga a ser honestos con lo que la señal significa: compara una visita
// contra las OTRAS veces que alguien fue a esa tienda. Es consistencia, no
// verdad — si la primera visita se capturó en el lugar equivocado, la referencia
// nace mal. Con una sola visita no hay referencia y la señal lo dice. La
// verificación de verdad necesita las coordenadas oficiales del retailer; cuando
// existan, `puntoDeReferencia` las prefiere y todo lo demás sigue igual.

export type Estado = "ok" | "revisar" | "sin-referencia";

export interface Senal {
  clave: "ubicacion" | "precision" | "salto" | "evidencia" | "duplicada" | "corregida";
  estado: Estado;
  /** Una línea, en palabras de quien lee el reporte. */
  texto: string;
}

export interface VisitaValidable {
  id: string;
  capturada_en: string;
  latitud: number | null;
  longitud: number | null;
  precision_gps: number | null;
  agente_id: string;
  tienda_id: string;
  marca_id: string;
  fotos: number;
  correcciones: number;
}

export interface Referencia {
  lat: number;
  lng: number;
  /** Cuántas visitas la sustentan. Con 1 no hay con qué comparar. */
  visitas: number;
  /** true si viene del catálogo del retailer y no de las visitas. */
  oficial: boolean;
}

// ---- umbrales ----
//
// Elegidos contra los datos reales del piloto, no de la nada: las lecturas
// repetidas en una misma tienda caen dentro de ±0 a 14 m, y la velocidad
// implícita más alta observada entre visitas seguidas fue de 14 km/h.

/** Más lejos que esto de la referencia, hay que mirar la visita. Una plaza
 *  comercial grande mide 200 m de punta a punta, así que 250 no es una tienda
 *  distinta por error de GPS: es otro lugar. */
export const LIMITE_DISTANCIA_M = 250;
/** Una lectura con este radio ya no ubica dentro de una plaza. */
export const LIMITE_PRECISION_M = 150;
/** Velocidad implícita imposible entre dos visitas del mismo agente. Deja pasar
 *  carretera (110) y no deja pasar un salto entre ciudades. */
export const LIMITE_KMH = 140;
/** Debajo de esta distancia el salto no se evalúa: dos visitas en la misma plaza
 *  con minutos de diferencia dan velocidades enormes sin significar nada. */
const MINIMO_SALTO_M = 1000;

// ---- geometría ----

const R = 6371000;
const rad = (g: number) => (g * Math.PI) / 180;

export function metrosEntre(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function mediana(xs: number[]): number {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * Punto de referencia de una tienda. Prefiere el oficial del catálogo; si no
 * hay, saca la mediana de las lecturas de sus visitas.
 */
export function puntoDeReferencia(
  visitas: VisitaValidable[],
  oficial?: { lat: number | null; lng: number | null } | null
): Referencia | null {
  if (oficial?.lat != null && oficial?.lng != null) {
    return { lat: oficial.lat, lng: oficial.lng, visitas: visitas.length, oficial: true };
  }
  const con = visitas.filter((v) => v.latitud != null && v.longitud != null);
  if (con.length === 0) return null;
  return {
    lat: mediana(con.map((v) => v.latitud as number)),
    lng: mediana(con.map((v) => v.longitud as number)),
    visitas: con.length,
    oficial: false,
  };
}

/**
 * Señales de UNA visita. `anterior` es la visita previa del MISMO agente (por
 * hora de captura), o null si es la primera.
 */
export function validar(
  v: VisitaValidable,
  ctx: {
    referencia: Referencia | null;
    anterior: VisitaValidable | null;
    fotosEsperadas: number;
    otrasDelDia: number; // mismas tienda+marca+día, sin contar esta
  }
): Senal[] {
  const s: Senal[] = [];

  // 1) ¿Concuerda con dónde está la tienda?
  if (v.latitud == null || v.longitud == null) {
    s.push({ clave: "ubicacion", estado: "revisar", texto: "Sin coordenadas." });
  } else if (!ctx.referencia) {
    s.push({ clave: "ubicacion", estado: "sin-referencia", texto: "Sin punto de referencia." });
  } else if (!ctx.referencia.oficial && ctx.referencia.visitas < 2) {
    // Compararla contra una referencia hecha solo con ella misma daría 0 m
    // siempre: un verde que no significa nada.
    s.push({
      clave: "ubicacion",
      estado: "sin-referencia",
      texto: "Única visita a esta tienda: nada con qué comparar.",
    });
  } else {
    const m = Math.round(
      metrosEntre(v.latitud, v.longitud, ctx.referencia.lat, ctx.referencia.lng)
    );
    const comparada = ctx.referencia.oficial ? "de la tienda" : "de las otras visitas";
    s.push({
      clave: "ubicacion",
      estado: m > LIMITE_DISTANCIA_M ? "revisar" : "ok",
      texto: `A ${m} m ${comparada}.`,
    });
  }

  // 2) ¿Qué tan buena fue la lectura?
  if (v.precision_gps == null) {
    s.push({ clave: "precision", estado: "sin-referencia", texto: "Precisión no registrada." });
  } else {
    const p = Math.round(v.precision_gps);
    s.push({
      clave: "precision",
      estado: p > LIMITE_PRECISION_M ? "revisar" : "ok",
      texto: `Lectura de ± ${p} m.`,
    });
  }

  // 3) ¿Pudo llegar de la visita anterior?
  const a = ctx.anterior;
  if (!a || a.latitud == null || a.longitud == null || v.latitud == null || v.longitud == null) {
    s.push({ clave: "salto", estado: "sin-referencia", texto: "Sin visita previa que comparar." });
  } else {
    const m = metrosEntre(a.latitud, a.longitud, v.latitud, v.longitud);
    const seg = (Date.parse(v.capturada_en) - Date.parse(a.capturada_en)) / 1000;
    if (m < MINIMO_SALTO_M) {
      s.push({ clave: "salto", estado: "ok", texto: "Siguió cerca de la visita anterior." });
    } else if (seg <= 0) {
      // Dos capturas con la misma hora, o en desorden: el reloj del teléfono es
      // del teléfono, y sin tiempo no hay velocidad que calcular.
      s.push({ clave: "salto", estado: "revisar", texto: "Hora de captura inconsistente." });
    } else {
      const kmh = Math.round(m / 1000 / (seg / 3600));
      s.push({
        clave: "salto",
        estado: kmh > LIMITE_KMH ? "revisar" : "ok",
        texto: `${Math.round(m / 1000)} km desde la anterior (${kmh} km/h).`,
      });
    }
  }

  // 4) ¿Está la evidencia completa? Es la regla que no se negocia.
  s.push(
    v.fotos >= ctx.fotosEsperadas
      ? { clave: "evidencia", estado: "ok", texto: `${v.fotos} fotos.` }
      : {
          clave: "evidencia",
          estado: "revisar",
          texto: `${v.fotos} de ${ctx.fotosEsperadas} fotos.`,
        }
  );

  // 5) ¿Hay otra igual el mismo día?
  if (ctx.otrasDelDia > 0) {
    s.push({
      clave: "duplicada",
      estado: "revisar",
      texto:
        ctx.otrasDelDia === 1
          ? "Otra visita a la misma tienda y marca ese día."
          : `${ctx.otrasDelDia} visitas más a la misma tienda y marca ese día.`,
    });
  }

  // 6) ¿Alguien corrigió el dato? No es una falla, pero quien lee el reporte
  //    tiene derecho a saber que la fila no es la original.
  if (v.correcciones > 0) {
    s.push({
      clave: "corregida",
      estado: "revisar",
      texto: v.correcciones === 1 ? "Tienda corregida a mano." : `${v.correcciones} correcciones.`,
    });
  }

  return s;
}

/** Cuántas señales piden revisión. 0 = la visita pasa sin observaciones. */
export function aRevisar(senales: Senal[]): number {
  return senales.filter((x) => x.estado === "revisar").length;
}
