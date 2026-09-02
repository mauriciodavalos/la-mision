// Popup mínimo, propio y sin dependencias.
//
// POR QUÉ EXISTE
//
// Hasta ahora la app solo tenía avisos en línea (mostrarBanner, .bs-recuperar).
// Eso alcanza para algo que el agente puede leer cuando quiera, pero no para dos
// cosas que sí tienen que interrumpir:
//
//   * confirmar que un registro llegó al SERVIDOR (antes de esto, al guardar la
//     pantalla simplemente se vaciaba y el agente no sabía si se había guardado);
//   * decirle qué hacer cuando falta la ubicación, que es lo único que le impide
//     capturar.
//
// La pieza que no da un `alert()` del navegador y aquí sí hace falta es
// `actualizar()`: el aviso de subida cambia de estado —guardando, subiendo,
// subido— mientras ya está en pantalla.
//
// Todo el texto entra como TEXTO, no como HTML: los nombres de tienda y los
// mensajes de error vienen de la base y del servidor, y no se pueden pegar
// crudos en el DOM.

export type TonoModal = "neutro" | "exito" | "alerta";

export interface AccionModal {
  texto: string;
  /** Qué hacer al tocarlo. Si devuelve una promesa, se espera antes de cerrar. */
  alTocar?: () => void | Promise<void>;
  /** Si cierra el popup al terminar. Por omisión, sí. */
  cierra?: boolean;
  principal?: boolean;
}

export interface ContenidoModal {
  titulo: string;
  cuerpo?: string;
  /** Lista numerada — para instrucciones tipo "Ajustes → Safari → Ubicación". */
  pasos?: string[];
  /** Línea chica al final, para matices que no deben competir con el cuerpo. */
  nota?: string;
  acciones?: AccionModal[];
  tono?: TonoModal;
  /** Si se puede cerrar tocando el fondo o con Escape. Por omisión, sí. */
  descartable?: boolean;
}

export interface Modal {
  actualizar(c: ContenidoModal): void;
  cerrar(): void;
  readonly vivo: boolean;
}

// Uno a la vez: dos popups encimados en un teléfono son ilegibles, y el caso real
// (guardar una visita mientras el aviso de ubicación sigue abierto) es fácil de
// provocar. El nuevo reemplaza al anterior.
let actual: Modal | null = null;

function texto(padre: HTMLElement, etiqueta: string, clase: string, valor: string) {
  const el = document.createElement(etiqueta);
  el.className = clase;
  el.textContent = valor; // nunca innerHTML: el valor puede venir del servidor
  padre.appendChild(el);
  return el;
}

export function abrirModal(c: ContenidoModal): Modal {
  actual?.cerrar();

  const fondo = document.createElement("div");
  fondo.className = "bs-modal-fondo";
  const caja = document.createElement("div");
  caja.className = "bs-modal";
  caja.setAttribute("role", "dialog");
  caja.setAttribute("aria-modal", "true");
  fondo.appendChild(caja);

  let descartable = true;
  let vivo = true;

  const pintar = (c: ContenidoModal) => {
    descartable = c.descartable !== false;
    caja.className = "bs-modal" + (c.tono && c.tono !== "neutro" ? ` is-${c.tono}` : "");
    caja.innerHTML = "";

    texto(caja, "h2", "bs-modal-t", c.titulo);
    if (c.cuerpo) texto(caja, "p", "bs-modal-c", c.cuerpo);

    if (c.pasos?.length) {
      const ol = document.createElement("ol");
      ol.className = "bs-modal-pasos";
      for (const p of c.pasos) texto(ol, "li", "", p);
      caja.appendChild(ol);
    }

    if (c.nota) texto(caja, "p", "bs-modal-n", c.nota);

    if (c.acciones?.length) {
      const barra = document.createElement("div");
      barra.className = "bs-modal-b";
      for (const a of c.acciones) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bs-mini" + (a.principal ? " is-principal" : "");
        btn.textContent = a.texto;
        btn.addEventListener("click", async () => {
          // Se bloquea mientras corre: sin esto, dos toques seguidos en
          // "Reintentar" lanzan dos búsquedas de GPS a la vez.
          btn.disabled = true;
          try {
            await a.alTocar?.();
          } finally {
            btn.disabled = false;
          }
          if (a.cierra !== false) cerrar();
        });
        barra.appendChild(btn);
      }
      caja.appendChild(barra);
    }
  };

  const alTeclado = (e: KeyboardEvent) => {
    if (e.key === "Escape" && descartable) cerrar();
  };

  function cerrar() {
    if (!vivo) return;
    vivo = false;
    document.removeEventListener("keydown", alTeclado);
    fondo.remove();
    // Se devuelve el scroll al fondo solo si no quedó otro popup abierto.
    if (actual === modal) {
      actual = null;
      document.body.style.overflow = "";
    }
  }

  fondo.addEventListener("click", (e) => {
    if (e.target === fondo && descartable) cerrar();
  });
  document.addEventListener("keydown", alTeclado);

  pintar(c);
  document.body.appendChild(fondo);
  document.body.style.overflow = "hidden";
  // El primer botón toma el foco: en teléfono no cambia nada, pero en la
  // computadora deja el popup usable con teclado.
  caja.querySelector<HTMLButtonElement>("button")?.focus();

  const modal: Modal = {
    actualizar: (nuevo) => {
      if (vivo) pintar(nuevo);
    },
    cerrar,
    get vivo() {
      return vivo;
    },
  };
  actual = modal;
  return modal;
}
