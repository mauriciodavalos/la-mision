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

    // El respaldo (navegador sin escalado nativo) decodifica con <img>. Se
    // simula aquí porque ese camino es justo el que corre en los teléfonos
    // viejos, o sea los que se quedan sin memoria.
    urlsVivas = 0;
    // Se HEREDA de la URL real en vez de reemplazarla por un objeto suelto: los
    // globales que pone una suite se los queda el proceso, y borrar el
    // constructor dejaba sin `new URL(...)` a todo lo que corriera después.
    // Salió a la luz al agregar la suite `corregir`, cuyo módulo construye el
    // cliente de Supabase y valida la URL al importarse.
    class URLSimulada extends globalThis.URL {}
    URLSimulada.createObjectURL = () => {
      urlsVivas++;
      return "blob:sim";
    };
    URLSimulada.revokeObjectURL = () => urlsVivas--;
    globalThis.URL = URLSimulada;
    globalThis.Image = class {
      constructor() {
        this.naturalWidth = 0;
        this.naturalHeight = 0;
        this.src = "";
      }
      async decode() {
        [this.naturalWidth, this.naturalHeight] = ultimaFoto.__dim;
      }
    };
  }

  let urlsVivas = 0;
  let ultimaFoto = { __dim: [0, 0] };

  const foto = (ancho, alto) => {
    ultimaFoto = { size: 4200000, __dim: [ancho, alto] };
    return ultimaFoto;
  };

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
  check(
    cerrados === 0,
    "el respaldo ya NO usa createImageBitmap sin escalar: esa era la línea que reventaba"
  );
  check(
    urlsVivas === 0,
    "el respaldo revoca su object URL: dejarla viva mantiene la foto original en memoria"
  );
}
