// Pruebas de comportamiento, sin dependencias nuevas: se corren con `npm run prueba`.
//
// Por qué existen: `astro check` limpio no prueba NADA del comportamiento. Estas
// dos suites cubren las correcciones que salieron del primer día en campo (31 ago
// 2026) y que son difíciles de probar a mano en un teléfono:
//
//  * gps: que la ubicación se busque en dos etapas, que no insista de balde
//    cuando el permiso está bloqueado, y que el seguimiento conserve la MEJOR
//    lectura. De esto depende que se pueda exigir ubicación sin dejar a un
//    agente sin capturar adentro de una tienda.
//  * comprimir: que la foto se escale DURANTE la decodificación, que es lo que
//    evita que el teléfono se quede sin memoria al tomarla.
//
// Se bundlean los módulos con esbuild (ya viene con Astro) y se corren en Node
// con las APIs del navegador simuladas: geolocation, createImageBitmap y canvas.

import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aquí = dirname(fileURLToPath(import.meta.url));
const raíz = resolve(aquí, "..");
const salida = join(raíz, "node_modules", ".tmp-pruebas");

async function bundle(entrada, nombre) {
  const archivo = join(salida, nombre);
  await build({
    entryPoints: [join(raíz, entrada)],
    bundle: true,
    format: "esm",
    outfile: archivo,
    logLevel: "error",
  });
  return import(pathToFileURL(archivo).href);
}

// ---- mini arnés de pruebas ----
let fallos = 0;
let total = 0;
export function check(ok, texto) {
  total++;
  if (!ok) fallos++;
  console.log((ok ? "  ok   " : "  FALLA") + "  " + texto);
}

const suites = [
  ["gps — ubicación obligatoria", "./gps.prueba.mjs", "src/lib/gps.ts", "gps.mjs"],
  ["comprimir — memoria del teléfono", "./comprimir.prueba.mjs", "src/lib/comprimir.ts", "comprimir.mjs"],
  ["rastro — de qué se murió la pestaña", "./rastro.prueba.mjs", "src/lib/rastro.ts", "rastro.mjs"],
  ["avisos — cuándo interrumpir al agente", "./avisos.prueba.mjs", "src/lib/avisos.ts", "avisos.mjs"],
];

await mkdir(salida, { recursive: true });

for (const [titulo, prueba, fuente, nombre] of suites) {
  console.log("\n" + titulo);
  const mod = await bundle(fuente, nombre);
  const { correr } = await import(prueba);
  await correr(mod, check);
}

await rm(salida, { recursive: true, force: true });

console.log(
  fallos === 0
    ? `\nTodo bien: ${total} comprobaciones.`
    : `\n${fallos} de ${total} comprobaciones FALLARON.`
);
process.exit(fallos ? 1 : 0);
