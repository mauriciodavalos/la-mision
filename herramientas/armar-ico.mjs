// Arma un .ico de verdad a partir de varios PNG.
//
// El favicon.ico que traía el repo era el de Astro por omisión: un PNG de 32x32
// con la extensión cambiada. Los navegadores lo toleran porque olfatean el
// contenido, pero no es un ICO y solo trae un tamaño.
//
// Formato: ICONDIR (6 bytes) + una ICONDIRENTRY de 16 bytes por imagen + los
// datos. Desde Windows Vista una entrada puede llevar el PNG tal cual en vez de
// un BMP, y todos los navegadores actuales lo leen; es lo que se hace aquí,
// porque un BMP con máscara de transparencia pesaría varias veces más.

import { readFileSync, writeFileSync } from "node:fs";

const [, , salida, ...entradas] = process.argv;

const imagenes = entradas.map((ruta) => {
  const datos = readFileSync(ruta);
  if (datos.subarray(0, 4).toString("hex") !== "89504e47") {
    throw new Error(`${ruta} no es un PNG`);
  }
  // El IHDR de un PNG empieza en el byte 16: ancho y alto, big-endian.
  const ancho = datos.readUInt32BE(16);
  const alto = datos.readUInt32BE(20);
  if (ancho > 256 || alto > 256) throw new Error(`${ruta}: ${ancho}x${alto} no cabe en un ICO`);
  return { datos, ancho, alto, ruta };
});

const CABECERA = 6;
const ENTRADA = 16;
const dir = Buffer.alloc(CABECERA + ENTRADA * imagenes.length);
dir.writeUInt16LE(0, 0); // reservado
dir.writeUInt16LE(1, 2); // 1 = icono
dir.writeUInt16LE(imagenes.length, 4);

let desplazamiento = dir.length;
for (const [i, img] of imagenes.entries()) {
  const o = CABECERA + i * ENTRADA;
  dir.writeUInt8(img.ancho === 256 ? 0 : img.ancho, o); // 0 significa 256
  dir.writeUInt8(img.alto === 256 ? 0 : img.alto, o + 1);
  dir.writeUInt8(0, o + 2); // colores de la paleta: 0 = sin paleta
  dir.writeUInt8(0, o + 3); // reservado
  dir.writeUInt16LE(1, o + 4); // planos
  dir.writeUInt16LE(32, o + 6); // bits por pixel
  dir.writeUInt32LE(img.datos.length, o + 8);
  dir.writeUInt32LE(desplazamiento, o + 12);
  desplazamiento += img.datos.length;
}

writeFileSync(salida, Buffer.concat([dir, ...imagenes.map((i) => i.datos)]));
console.log(
  `${salida}: ${imagenes.map((i) => `${i.ancho}x${i.alto}`).join(", ")} · ` +
    `${Buffer.concat([dir, ...imagenes.map((i) => i.datos)]).length} bytes`
);
