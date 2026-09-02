// Los bloques que se cuelgan de <body> no pueden depender de la paleta.
//
// EL BUG QUE ATRAPA
//
// La paleta (--paper, --petrol, --alert…) está definida en `.bs-root`, que es el
// <div id="app">. Pero el popup (modal.ts) y la cámara (camara.ts) se agregan con
// `document.body.appendChild`, o sea FUERA de ese div. Ahí `var(--paper)` no
// resuelve a nada: el popup salió en producción con fondo transparente y texto
// del color por omisión —ilegible— y el disparador de la cámara, invisible sobre
// el fondo negro.
//
// Se arregló definiendo la paleta también en `:root`, pero eso solo no basta como
// garantía: cualquiera puede escribir mañana otra regla con var() para un
// elemento colgado del body. Esta prueba fija la regla al revés — esos bloques
// llevan colores literales — que es lo que no se puede romper por accidente.
//
// Es una revisión de texto, no del navegador. No prueba que se vea bonito;
// prueba que no se vuelva invisible.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raíz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Prefijos de las clases que viven fuera de .bs-root.
const FUERA_DE_ROOT = ["bs-modal", "bs-camara"];

export async function correr(_mod, check) {
  const css = readFileSync(join(raíz, "src/styles/captura.css"), "utf8");

  // 1) La paleta se define también en :root, que es lo que alcanza al <body>.
  check(
    /:root\s*,\s*\.bs-root\s*\{/.test(css),
    "la paleta se define en :root además de .bs-root: si no, no llega a <body>"
  );

  // 2) Ninguna regla de esos bloques usa var() para un color.
  const reglas = css.split("}");
  const culpables = [];
  for (const bloque of reglas) {
    const corte = bloque.lastIndexOf("{");
    if (corte < 0) continue;
    const selector = bloque.slice(0, corte);
    const cuerpo = bloque.slice(corte + 1);
    const fuera = FUERA_DE_ROOT.some((p) => selector.includes("." + p));
    if (fuera && /var\(--/.test(cuerpo)) {
      culpables.push(selector.trim().split("\n").pop().trim());
    }
  }
  check(
    culpables.length === 0,
    culpables.length === 0
      ? "el popup y la cámara usan colores literales, no variables que no heredan"
      : `usan var() fuera de .bs-root: ${culpables.join(" | ")}`
  );

  // 3) El popup va centrado, no pegado abajo: pegado abajo se perdía debajo de
  //    la barra fija de pendientes.
  const fondo = css.slice(css.indexOf(".bs-modal-fondo {"));
  check(
    /align-items:\s*center/.test(fondo.slice(0, 400)),
    "el popup se centra en la pantalla"
  );

  // 4) Los botones del popup se tocan con el pulgar: 48 px es el mínimo usable.
  check(
    /\.bs-modal \.bs-mini[^{]*\{[^}]*min-height:\s*48px/.test(css),
    "los botones del popup miden al menos 48 px de alto"
  );
}
