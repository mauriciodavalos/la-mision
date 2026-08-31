// Compresión de imágenes en el CLIENTE, antes de encolar.
// El costo real del producto es storage + egress de imágenes; comprimir aquí
// es lo que hace que el producto escale por número de clientes.
//
// POR QUÉ SE ESCALA AL DECODIFICAR
//
// La versión anterior hacía `createImageBitmap(file)` a secas: eso decodifica la
// foto COMPLETA en memoria. Una foto de 12 MP son ~48 MB de bitmap (12M px × 4
// bytes), más el canvas de destino, más el archivo original todavía vivo. En un
// teléfono justo de memoria el navegador mata la pestaña — el 31 de agosto, en
// campo, apareció como "Memoria insuficiente para completar la operación
// anterior" y la app se reiniciaba al tomar la foto, perdiendo lo capturado.
//
// Pasándole `resizeWidth`/`resizeHeight` a createImageBitmap, el navegador
// decodifica y escala en un solo paso nativo: el bitmap que llega a la página ya
// viene a 1600 px de lado mayor (~7.7 MB en vez de ~48 MB). Misma foto de salida,
// una fracción de la memoria.

const MAX_DIM = 1600; // lado mayor máximo en px
const CALIDAD = 0.8;  // calidad WebP
const SONDA = 64;     // lado del sondeo que solo sirve para saber la orientación

export interface Comprimida {
  blob: Blob;
  ancho: number;
  alto: number;
  bytes: number;
  bytesOriginal: number;
}

// Averigua si la foto es horizontal o vertical sin decodificarla completa: pide
// una copia diminuta (64 px de ancho, el alto lo calcula el navegador
// respetando la proporción) y la cierra de inmediato.
//
// Hace falta porque `resizeWidth` y `resizeHeight` fijan un lado, y cuál de los
// dos hay que fijar depende de la orientación: en una foto vertical, fijar el
// ancho en 1600 dejaría 2133 px de alto.
async function esHorizontal(file: File | Blob): Promise<boolean> {
  const sonda = await createImageBitmap(file, {
    resizeWidth: SONDA,
    resizeQuality: "low",
  });
  const horizontal = sonda.width >= sonda.height;
  sonda.close?.();
  return horizontal;
}

async function decodificarEscalado(file: File | Blob): Promise<ImageBitmap> {
  try {
    const opciones: ImageBitmapOptions = (await esHorizontal(file))
      ? { resizeWidth: MAX_DIM, resizeQuality: "high" }
      : { resizeHeight: MAX_DIM, resizeQuality: "high" };
    return await createImageBitmap(file, opciones);
  } catch {
    // Navegador que no acepta las opciones de escalado: se cae a la ruta de
    // antes. Gasta más memoria, pero es mejor que no poder capturar.
    return createImageBitmap(file);
  }
}

export async function comprimir(file: File | Blob): Promise<Comprimida> {
  const bitmap = await decodificarEscalado(file);

  // Si el escalado nativo funcionó, esto ya es 1 y no reescala. Si se cayó al
  // respaldo, aquí es donde la imagen se reduce.
  const escala = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new Error("No se pudo obtener el contexto 2D del canvas");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // El bitmap ya no hace falta: se suelta ANTES de codificar el WebP, para no
  // tener las dos copias en memoria al mismo tiempo.
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/webp", CALIDAD)
  );

  const ancho = canvas.width;
  const alto = canvas.height;
  // Poner el canvas en 0×0 es lo que libera su búfer en móviles; dejarlo con la
  // imagen dibujada mantiene varios MB ocupados hasta que pase el recolector.
  canvas.width = 0;
  canvas.height = 0;

  if (!blob) throw new Error("No se pudo comprimir la imagen a WebP");

  return {
    blob,
    ancho,
    alto,
    bytes: blob.size,
    bytesOriginal: file.size,
  };
}

export function kb(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return Math.round(bytes / 1024) + " KB";
}
