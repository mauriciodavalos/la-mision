// Memoria del teléfono: la foto debe escalarse DURANTE la decodificación.
//
// Decodificar una foto de 12 MP completa son ~48 MB de bitmap; eso es lo que
// mataba la pestaña en campo. Se simulan createImageBitmap y el canvas para
// comprobar qué opciones se piden y qué se libera (ver correr.mjs).

export async function correr({ comprimir }, check) {
  let opciones = [];
  let cerrados = 0;
  let canvas = null;

  function montar({ soportaResize = true } = {}) {
    opciones = [];
    cerrados = 0;

    globalThis.createImageBitmap = async (file, opts) => {
      opciones.push(opts);
      if (opts && !soportaResize) throw new TypeError("resizeWidth no soportado");
      const [w0, h0] = file.__dim;
      let w = w0;
      let h = h0;
      if (opts?.resizeWidth) {
        w = opts.resizeWidth;
        h = Math.round(h0 * (w / w0));
      } else if (opts?.resizeHeight) {
        h = opts.resizeHeight;
        w = Math.round(w0 * (h / h0));
      }
      return { width: w, height: h, close: () => cerrados++ };
    };

    canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage() {} }),
      toBlob: (cb) => cb({ size: 198000, type: "image/webp" }),
    };
    globalThis.document = { createElement: () => canvas };
  }

  const foto = (ancho, alto) => ({ size: 4200000, __dim: [ancho, alto] });

  // Foto vertical de 12 MP: la típica de un teléfono.
  montar();
  let r = await comprimir(foto(3024, 4032));
  check(opciones.length === 2, "un sondeo diminuto y una sola decodificación escalada");
  check(opciones[0].resizeWidth === 64, "el sondeo pide 64 px: memoria despreciable");
  check(
    opciones[1].resizeHeight === 1600 && !opciones[1].resizeWidth,
    "foto vertical: fija el ALTO en 1600 (fijar el ancho daría 2133 de alto)"
  );
  check(r.ancho === 1200 && r.alto === 1600, `sale 1200×1600 (fue ${r.ancho}×${r.alto})`);
  check(cerrados === 2, "cierra el sondeo y el bitmap: no deja bitmaps vivos");
  check(
    canvas.width === 0 && canvas.height === 0,
    "deja el canvas en 0×0, que es lo que suelta su búfer en móviles"
  );

  // Foto horizontal.
  montar();
  r = await comprimir(foto(4032, 3024));
  check(
    opciones[1].resizeWidth === 1600 && !opciones[1].resizeHeight,
    "foto horizontal: fija el ANCHO en 1600"
  );
  check(r.ancho === 1600 && r.alto === 1200, `sale 1600×1200 (fue ${r.ancho}×${r.alto})`);

  // Navegador que no acepta las opciones de escalado.
  montar({ soportaResize: false });
  r = await comprimir(foto(4032, 3024));
  check(
    r.ancho === 1600 && r.alto === 1200,
    "sin escalado nativo cae al respaldo y aun así entrega 1600×1200"
  );
}
