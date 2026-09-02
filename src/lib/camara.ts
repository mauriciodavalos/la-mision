// Cámara DENTRO de la app, sin salir al navegador.
//
// POR QUÉ EXISTE
//
// `<input type="file" capture="environment">` abre la app de cámara del sistema.
// Eso manda al navegador a segundo plano, y la app de cámara de un teléfono de
// 12 MP se lleva cientos de MB para su propio pipeline. Android libera memoria
// matando lo que está atrás: la pestaña. El agente da "aceptar", regresa, y el
// navegador ya estaba muerto — de ahí "Memoria insuficiente para completar la
// operación anterior".
//
// Ese crash ocurre ANTES de que corra una sola línea nuestra, así que no se
// arregla comprimiendo mejor. La única salida es no salir de la app.
//
// Aquí se abre la cámara con getUserMedia sobre un <video>, y al disparar se
// copia el cuadro a un canvas. Ventajas:
//
//   * El navegador nunca pasa a segundo plano: no hay nada que matar.
//   * Se pide un cuadro de ~1920 px, no una foto de 12 MP. El bitmap que toca
//     la memoria es de ~8 MB en vez de ~48 MB, y ya sale del tamaño que
//     guardamos igual (1600 px de lado mayor): la foto que se sube es
//     prácticamente la misma.
//   * No hay archivo original vivo en RAM mientras se comprime.
//
// Se pierde un poco de detalle contra la foto de 12 MP — que de todas formas
// tirábamos al escalar a 1600 px. Para un anaquel y un acercamiento de producto
// alcanza de sobra, y es la diferencia entre capturar y no poder capturar.
//
// Requiere HTTPS (Netlify lo es) y permiso de cámara, que se pide la primera vez.

import type { Comprimida } from "./comprimir";
import { marcar } from "./rastro";

const MAX_DIM = 1600;
const CALIDAD = 0.8;

export type MotivoCamara = "sin_soporte" | "permiso" | "no_disponible" | "cancelada";

export type ResultadoCamara =
  | { ok: true; foto: Comprimida }
  | { ok: false; motivo: MotivoCamara };

export function soportaCamara(): boolean {
  return !!navigator.mediaDevices?.getUserMedia;
}

export function explicarCamara(motivo: MotivoCamara): string {
  switch (motivo) {
    case "permiso":
      return (
        "El permiso de cámara está bloqueado en este navegador. " +
        "En Android: Chrome → los tres puntos → Configuración → Configuración de sitios → Cámara. " +
        "En iPhone: Ajustes → Safari → Cámara → Permitir."
      );
    case "no_disponible":
      return "No se pudo abrir la cámara. Cierra otras apps que la estén usando y vuelve a intentar.";
    case "sin_soporte":
      return "Este navegador no permite abrir la cámara dentro de la app. Usa el modo normal.";
    case "cancelada":
      return "";
  }
}

// El cuadro que se pide a la cámara. No se pide el máximo: 1920 basta para lo
// que guardamos y mantiene el consumo de memoria bajo, que es todo el punto.
const RESTRICCIONES: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1440 },
  },
  audio: false,
};

function motivoDe(e: unknown): MotivoCamara {
  const nombre = (e as { name?: string })?.name ?? "";
  if (nombre === "NotAllowedError" || nombre === "SecurityError") return "permiso";
  if (nombre === "NotFoundError" || nombre === "OverconstrainedError") return "no_disponible";
  return "no_disponible";
}

/**
 * Abre la cámara a pantalla completa y resuelve con la foto ya comprimida.
 * Siempre libera el stream, incluso si el agente cancela o algo truena: un
 * `MediaStreamTrack` vivo deja la cámara prendida y quemando batería.
 */
export async function tomarFoto(etiqueta: string): Promise<ResultadoCamara> {
  if (!soportaCamara()) return { ok: false, motivo: "sin_soporte" };

  marcar("camara-app-abriendo");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(RESTRICCIONES);
  } catch (e) {
    marcar("camara-app-fallo", (e as { name?: string })?.name ?? "desconocido");
    return { ok: false, motivo: motivoDe(e) };
  }

  const capa = document.createElement("div");
  capa.className = "bs-camara";
  capa.innerHTML = `
    <video class="bs-camara-v" playsinline autoplay muted></video>
    <div class="bs-camara-barra">
      <button type="button" class="bs-camara-x" id="cam-cancelar">Cancelar</button>
      <button type="button" class="bs-camara-shot" id="cam-disparar" aria-label="Tomar foto"></button>
      <span class="bs-camara-et"></span>
    </div>
    <p class="bs-camara-t"></p>`;
  // textContent, no innerHTML: la etiqueta viene de la config de la marca.
  capa.querySelector(".bs-camara-t")!.textContent = etiqueta;
  document.body.appendChild(capa);

  const video = capa.querySelector("video") as HTMLVideoElement;
  video.srcObject = stream;

  const cerrar = () => {
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
    capa.remove();
  };

  try {
    await video.play().catch(() => undefined);
    // Sin esperar a que haya cuadro, el canvas sale en negro.
    if (video.readyState < 2) {
      await new Promise<void>((res) => {
        const listo = () => res();
        video.addEventListener("loadeddata", listo, { once: true });
        window.setTimeout(listo, 4000); // no dejar al agente esperando para siempre
      });
    }
    marcar("camara-app-lista", `${video.videoWidth}×${video.videoHeight}`);

    const disparo = await new Promise<boolean>((res) => {
      capa.querySelector("#cam-disparar")!.addEventListener("click", () => res(true));
      capa.querySelector("#cam-cancelar")!.addEventListener("click", () => res(false));
    });
    if (!disparo) {
      marcar("camara-app-cancelada");
      return { ok: false, motivo: "cancelada" };
    }

    const anchoV = video.videoWidth;
    const altoV = video.videoHeight;
    if (!anchoV || !altoV) {
      marcar("camara-app-sin-cuadro");
      return { ok: false, motivo: "no_disponible" };
    }

    marcar("camara-app-disparo", `${anchoV}×${altoV}`);
    const escala = Math.min(1, MAX_DIM / Math.max(anchoV, altoV));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(anchoV * escala);
    canvas.height = Math.round(altoV * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, motivo: "no_disponible" };
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/webp", CALIDAD)
    );
    const ancho = canvas.width;
    const alto = canvas.height;
    // Igual que en comprimir.ts: dejar el canvas en 0×0 es lo que suelta su
    // búfer en móviles.
    canvas.width = 0;
    canvas.height = 0;

    if (!blob) {
      marcar("camara-app-sin-webp");
      return { ok: false, motivo: "no_disponible" };
    }

    marcar("camara-app-listo", `${ancho}×${alto} · ${blob.size} bytes`);
    return {
      ok: true,
      // bytesOriginal = bytes: el cuadro nunca existió como archivo aparte, así
      // que no hay un "antes" que reportar (renderSlot lo contempla).
      foto: { blob, ancho, alto, bytes: blob.size, bytesOriginal: blob.size },
    };
  } finally {
    cerrar();
  }
}
