// Compresión de imágenes en el CLIENTE, antes de encolar.
// El costo real del producto es storage + egress de imágenes; comprimir aquí
// es lo que hace que el producto escale por número de clientes.

const MAX_DIM = 1600; // lado mayor máximo en px
const CALIDAD = 0.8;  // calidad WebP

export interface Comprimida {
  blob: Blob;
  ancho: number;
  alto: number;
  bytes: number;
  bytesOriginal: number;
}

export async function comprimir(file: File | Blob): Promise<Comprimida> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo obtener el contexto 2D del canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/webp", CALIDAD)
  );
  bitmap.close?.();
  if (!blob) throw new Error("No se pudo comprimir la imagen a WebP");

  return {
    blob,
    ancho: canvas.width,
    alto: canvas.height,
    bytes: blob.size,
    bytesOriginal: file.size,
  };
}

export function kb(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return Math.round(bytes / 1024) + " KB";
}
