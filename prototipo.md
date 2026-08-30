import React, { useState, useRef, useEffect } from "react";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Archivo:wght@400;500;600&family=Roboto+Mono:wght@400;500&display=swap');

.bs-root {
  --petrol: #123B3A;
  --petrol-dp: #0C2A29;
  --steel: #E6E8E3;
  --paper: #F3F4F1;
  --ink: #14181B;
  --ink-soft: #5C6660;
  --hivis: #D8F045;
  --alert: #C4462B;
  --line: #C6CAC2;
  font-family: 'Archivo', system-ui, sans-serif;
  background: var(--steel);
  color: var(--ink);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
.bs-root * { box-sizing: border-box; }
.bs-shell { max-width: 560px; margin: 0 auto; padding-bottom: 92px; }
.bs-shell.is-wide { max-width: 1040px; }

/* ---- header ---- */
.bs-head {
  background: var(--petrol);
  color: var(--paper);
  padding: 18px 20px 0;
}
.bs-head-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.bs-brand {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: .22em;
  text-transform: uppercase;
  color: var(--hivis);
  margin: 0;
}
.bs-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 600;
  font-size: 34px;
  line-height: .95;
  letter-spacing: -.005em;
  text-transform: uppercase;
  margin: 4px 0 0;
}
.bs-chip {
  font-family: 'Roboto Mono', monospace;
  font-size: 10px;
  letter-spacing: .1em;
  text-transform: uppercase;
  padding: 5px 9px;
  border: 1px solid rgba(243,244,241,.35);
  border-radius: 2px;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.bs-chip.is-on { color: var(--hivis); border-color: rgba(216,240,69,.5); }
.bs-chip.is-off { color: #F0B8A8; border-color: rgba(240,184,168,.45); }
.bs-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.bs-dot.is-live { animation: bs-pulse 1.8s ease-in-out infinite; }
@keyframes bs-pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }

.bs-tabs { display: flex; gap: 0; margin-top: 18px; }
.bs-tab {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 15px;
  letter-spacing: .12em;
  text-transform: uppercase;
  font-weight: 600;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  color: rgba(243,244,241,.55);
  padding: 10px 16px;
  cursor: pointer;
}
.bs-tab.is-active { color: var(--paper); border-bottom-color: var(--hivis); }
.bs-tab:focus-visible { outline: 2px solid var(--hivis); outline-offset: -2px; }

/* ---- field rows ---- */
.bs-body { padding: 0 20px; }
.bs-field { border-bottom: 1px solid var(--line); padding: 20px 0; }
.bs-field:last-of-type { border-bottom: none; }
.bs-legend { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.bs-num {
  font-family: 'Roboto Mono', monospace;
  font-size: 11px;
  color: var(--ink-soft);
  padding-top: 2px;
}
.bs-label {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: .07em;
  text-transform: uppercase;
  margin: 0;
}
.bs-req { color: var(--alert); font-size: 13px; }
.bs-hint { font-size: 12.5px; color: var(--ink-soft); margin: 0 0 10px 30px; line-height: 1.45; }
.bs-inner { margin-left: 30px; }

.bs-input, .bs-select, .bs-area {
  width: 100%;
  font-family: 'Archivo', sans-serif;
  font-size: 15px;
  padding: 12px 12px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 2px;
  color: var(--ink);
}
.bs-area { resize: vertical; min-height: 62px; }
.bs-input:focus, .bs-select:focus, .bs-area:focus { outline: 2px solid var(--petrol); outline-offset: 1px; }

.bs-picked {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  background: var(--petrol); color: var(--paper);
  padding: 12px 14px; border-radius: 2px;
}
.bs-picked-name { font-weight: 600; font-size: 15px; }
.bs-picked-meta { font-family: 'Roboto Mono', monospace; font-size: 11px; color: var(--hivis); margin-top: 3px; }
.bs-clear {
  background: none; border: 1px solid rgba(243,244,241,.4); color: var(--paper);
  font-family: 'Roboto Mono', monospace; font-size: 10px; letter-spacing: .08em;
  padding: 6px 8px; border-radius: 2px; cursor: pointer; text-transform: uppercase;
}
.bs-results { border: 1px solid var(--line); border-top: none; max-height: 190px; overflow-y: auto; background: var(--paper); }
.bs-result {
  display: block; width: 100%; text-align: left; background: none; border: none;
  border-bottom: 1px solid var(--line); padding: 11px 12px; cursor: pointer; font-family: 'Archivo', sans-serif;
}
.bs-result:hover, .bs-result:focus-visible { background: var(--hivis); outline: none; }
.bs-result-n { font-family: 'Roboto Mono', monospace; font-size: 11px; color: var(--ink-soft); }

/* ---- photo slots ---- */
.bs-slot {
  position: relative;
  border: 2px dashed var(--line);
  border-radius: 2px;
  background: var(--paper);
  aspect-ratio: 4/3;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; cursor: pointer; width: 100%; padding: 0;
  font-family: 'Archivo', sans-serif; color: var(--ink-soft);
  overflow: hidden;
  transition: border-color .15s ease;
}
.bs-slot:hover { border-color: var(--petrol); }
.bs-slot:focus-visible { outline: 2px solid var(--petrol); outline-offset: 2px; }
.bs-slot.is-filled { border-style: solid; border-color: var(--petrol); cursor: default; }
.bs-slot.is-wide-shot { aspect-ratio: 16/9; }
.bs-slot img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bs-slot-icon { font-family: 'Barlow Condensed', sans-serif; font-size: 30px; font-weight: 600; color: var(--line); }
.bs-slot-cta { font-family: 'Barlow Condensed', sans-serif; font-size: 15px; letter-spacing: .1em; text-transform: uppercase; font-weight: 600; }
.bs-slot-sub { font-size: 11.5px; }
.bs-badge {
  position: absolute; left: 8px; bottom: 8px;
  background: var(--petrol); color: var(--hivis);
  font-family: 'Roboto Mono', monospace; font-size: 10px;
  padding: 4px 7px; border-radius: 2px; letter-spacing: .04em;
}
.bs-retake {
  position: absolute; right: 8px; bottom: 8px;
  background: var(--paper); color: var(--ink); border: none;
  font-family: 'Roboto Mono', monospace; font-size: 10px; letter-spacing: .08em;
  padding: 6px 9px; border-radius: 2px; cursor: pointer; text-transform: uppercase;
}
.bs-working {
  position: absolute; inset: 0; background: rgba(18,59,58,.94); color: var(--hivis);
  display: flex; align-items: center; justify-content: center; gap: 10px;
  font-family: 'Roboto Mono', monospace; font-size: 11px; letter-spacing: .08em;
}
.bs-spin { width: 13px; height: 13px; border: 2px solid rgba(216,240,69,.3); border-top-color: var(--hivis); border-radius: 50%; animation: bs-rot .7s linear infinite; }
@keyframes bs-rot { to { transform: rotate(360deg); } }

/* ---- gps readout ---- */
.bs-gps { background: var(--petrol-dp); color: var(--paper); border-radius: 2px; padding: 14px; }
.bs-gps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
.bs-gps-k { font-family: 'Roboto Mono', monospace; font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; color: rgba(243,244,241,.5); }
.bs-gps-v { font-family: 'Roboto Mono', monospace; font-size: 14px; color: var(--hivis); margin-top: 3px; }
.bs-gps-v.is-muted { color: rgba(243,244,241,.45); }

/* ---- submit ---- */
.bs-submit {
  width: 100%; margin: 24px 0 8px;
  background: var(--petrol); color: var(--paper);
  border: none; border-radius: 2px; padding: 18px;
  font-family: 'Barlow Condensed', sans-serif; font-size: 20px; font-weight: 600;
  letter-spacing: .14em; text-transform: uppercase; cursor: pointer;
}
.bs-submit:enabled:hover { background: var(--petrol-dp); }
.bs-submit:disabled { background: var(--line); color: #8B928A; cursor: not-allowed; }
.bs-submit:focus-visible { outline: 3px solid var(--hivis); outline-offset: 2px; }
.bs-missing { font-family: 'Roboto Mono', monospace; font-size: 11px; color: var(--alert); text-align: center; margin: 0 0 16px; line-height: 1.6; }

/* ---- queue bar (signature) ---- */
.bs-queue {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: var(--petrol-dp); color: var(--paper);
  border-top: 3px solid var(--hivis);
  padding: 11px 20px;
  z-index: 20;
}
.bs-queue-in { max-width: 1040px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.bs-queue-l { display: flex; align-items: baseline; gap: 10px; }
.bs-queue-n { font-family: 'Barlow Condensed', sans-serif; font-size: 32px; font-weight: 700; line-height: 1; color: var(--hivis); }
.bs-queue-n.is-clear { color: rgba(243,244,241,.4); }
.bs-queue-t { font-family: 'Barlow Condensed', sans-serif; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; line-height: 1.25; }
.bs-queue-s { font-family: 'Roboto Mono', monospace; font-size: 10px; color: rgba(243,244,241,.5); display: block; letter-spacing: .04em; }
.bs-toggle {
  background: none; border: 1px solid rgba(243,244,241,.4); color: var(--paper);
  font-family: 'Roboto Mono', monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  padding: 9px 11px; border-radius: 2px; cursor: pointer; white-space: nowrap;
}
.bs-toggle:hover { border-color: var(--hivis); color: var(--hivis); }

/* ---- admin ---- */
.bs-rows { padding: 4px 0 0; }
.bs-row {
  display: grid; grid-template-columns: 92px 1fr auto;
  gap: 14px; align-items: center;
  padding: 14px 0; border-bottom: 1px solid var(--line);
}
.bs-thumbs { display: flex; gap: 3px; }
.bs-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 2px; background: var(--line); display: block; }
.bs-row-name { font-weight: 600; font-size: 14.5px; line-height: 1.3; }
.bs-row-meta { font-family: 'Roboto Mono', monospace; font-size: 10.5px; color: var(--ink-soft); margin-top: 4px; line-height: 1.6; }
.bs-state {
  font-family: 'Roboto Mono', monospace; font-size: 9.5px; letter-spacing: .09em; text-transform: uppercase;
  padding: 5px 8px; border-radius: 2px; white-space: nowrap;
}
.bs-state.is-sync { background: var(--petrol); color: var(--hivis); }
.bs-state.is-pend { background: #F2E5A8; color: #6B5410; }
.bs-empty { text-align: center; padding: 56px 20px; color: var(--ink-soft); }
.bs-empty-h { font-family: 'Barlow Condensed', sans-serif; font-size: 21px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink); margin: 0 0 6px; }
.bs-empty-p { font-size: 13.5px; margin: 0; }
.bs-stats { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--line); }
.bs-stat { padding: 16px 0; }
.bs-stat-n { font-family: 'Barlow Condensed', sans-serif; font-size: 30px; font-weight: 700; line-height: 1; }
.bs-stat-k { font-family: 'Roboto Mono', monospace; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); margin-top: 5px; }
.bs-note { font-size: 12px; color: var(--ink-soft); line-height: 1.55; padding: 16px 0 0; border-top: 1px solid var(--line); margin-top: 8px; }
.bs-hidden-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

@media (prefers-reduced-motion: reduce) {
  .bs-dot.is-live, .bs-spin { animation: none; }
}
`;

const TIENDAS = [
  { id: "t1", numero: "2841", nombre: "Walmart Supercenter Satélite", cadena: "Walmart" },
  { id: "t2", numero: "1176", nombre: "Bodega Aurrerá Tlalnepantla", cadena: "Bodega Aurrerá" },
  { id: "t3", numero: "3092", nombre: "Walmart Universidad", cadena: "Walmart" },
  { id: "t4", numero: "0455", nombre: "Bodega Aurrerá Ecatepec Centro", cadena: "Bodega Aurrerá" },
  { id: "t5", numero: "2210", nombre: "Walmart Toluca Metepec", cadena: "Walmart" },
  { id: "t6", numero: "1834", nombre: "Bodega Aurrerá Naucalpan", cadena: "Bodega Aurrerá" },
];

const MAX_DIM = 1600;
const CALIDAD = 0.8;

function kb(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return Math.round(bytes / 1024) + " KB";
}

function hora(d) {
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function fecha(d) {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

async function comprimir(file) {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", CALIDAD));
  bitmap.close?.();
  return {
    url: URL.createObjectURL(blob),
    pesoFinal: blob.size,
    pesoOriginal: file.size,
    ancho: canvas.width,
    alto: canvas.height,
  };
}

function RanuraFoto({ id, etiqueta, ayuda, foto, ocupado, onArchivo, onBorrar, ancha }) {
  const ref = useRef(null);
  return (
    <div style={{ position: "relative" }}>
      <input
        ref={ref}
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        className="bs-hidden-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onArchivo(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className={"bs-slot" + (foto ? " is-filled" : "") + (ancha ? " is-wide-shot" : "")}
        onClick={() => !foto && !ocupado && ref.current?.click()}
        aria-label={foto ? etiqueta + " capturada" : "Tomar " + etiqueta}
      >
        {foto ? (
          <img src={foto.url} alt={etiqueta} />
        ) : (
          <>
            <span className="bs-slot-icon" aria-hidden="true">[ + ]</span>
            <span className="bs-slot-cta">Tomar foto</span>
            <span className="bs-slot-sub">{ayuda}</span>
          </>
        )}
        {ocupado && (
          <span className="bs-working">
            <span className="bs-spin" aria-hidden="true" />
            Optimizando a WebP
          </span>
        )}
      </button>
      {foto && !ocupado && (
        <>
          <span className="bs-badge">
            {kb(foto.pesoOriginal)} → {kb(foto.pesoFinal)} · {foto.ancho}×{foto.alto}
          </span>
          <button type="button" className="bs-retake" onClick={onBorrar}>
            Repetir
          </button>
        </>
      )}
    </div>
  );
}

export default function CapturaExhibiciones() {
  const [vista, setVista] = useState("captura");
  const [enLinea, setEnLinea] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [tienda, setTienda] = useState(null);
  const [pano, setPano] = useState(null);
  const [close, setClose] = useState(null);
  const [cargando, setCargando] = useState({ pano: false, close: false });
  const [gps, setGps] = useState(null);
  const [notas, setNotas] = useState("");
  const [registros, setRegistros] = useState([]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGps({ lat: 19.4326, lng: -99.1332, precision: 42, simulado: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setGps({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          precision: Math.round(p.coords.accuracy),
          simulado: false,
        }),
      () => setGps({ lat: 19.4326, lng: -99.1332, precision: 42, simulado: true }),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  // Sincroniza la cola cuando vuelve la señal
  useEffect(() => {
    if (!enLinea) return;
    const pendientes = registros.filter((r) => r.estado === "pendiente");
    if (pendientes.length === 0) return;
    const t = setTimeout(() => {
      setRegistros((prev) =>
        prev.map((r) =>
          r.estado === "pendiente" ? { ...r, estado: "sincronizado", subida: new Date() } : r
        )
      );
    }, 1400);
    return () => clearTimeout(t);
  }, [enLinea, registros]);

  const manejarFoto = async (cual, file) => {
    setCargando((c) => ({ ...c, [cual]: true }));
    try {
      const r = await comprimir(file);
      (cual === "pano" ? setPano : setClose)(r);
    } catch {
      (cual === "pano" ? setPano : setClose)(null);
    } finally {
      setCargando((c) => ({ ...c, [cual]: false }));
    }
  };

  const faltan = [];
  if (!tienda) faltan.push("tienda");
  if (!pano) faltan.push("panorámica");
  if (!close) faltan.push("close-up");
  const listo = faltan.length === 0;

  const guardar = () => {
    if (!listo) return;
    const ahora = new Date();
    setRegistros((prev) => [
      {
        id: String(Date.now()),
        tienda,
        pano,
        close,
        gps,
        notas: notas.trim(),
        captura: ahora,
        subida: null,
        estado: "pendiente",
      },
      ...prev,
    ]);
    setTienda(null);
    setBusqueda("");
    setPano(null);
    setClose(null);
    setNotas("");
  };

  const filtradas = busqueda.trim()
    ? TIENDAS.filter((t) =>
        (t.nombre + " " + t.numero + " " + t.cadena).toLowerCase().includes(busqueda.toLowerCase())
      )
    : TIENDAS;

  const pendientes = registros.filter((r) => r.estado === "pendiente").length;
  const sincronizados = registros.length - pendientes;

  return (
    <div className="bs-root">
      <style>{CSS}</style>

      <header className="bs-head">
        <div className={"bs-shell" + (vista === "registros" ? " is-wide" : "")} style={{ paddingBottom: 0 }}>
          <div className="bs-head-top">
            <div>
              <p className="bs-brand">Bikes Shot</p>
              <h1 className="bs-title">
                Control de
                <br />
                exhibición
              </h1>
            </div>
            <span className={"bs-chip " + (enLinea ? "is-on" : "is-off")}>
              <span className={"bs-dot" + (enLinea ? " is-live" : "")} />
              {enLinea ? "En línea" : "Sin señal"}
            </span>
          </div>
          <nav className="bs-tabs">
            <button
              className={"bs-tab" + (vista === "captura" ? " is-active" : "")}
              onClick={() => setVista("captura")}
            >
              Capturar
            </button>
            <button
              className={"bs-tab" + (vista === "registros" ? " is-active" : "")}
              onClick={() => setVista("registros")}
            >
              Registros ({registros.length})
            </button>
          </nav>
        </div>
      </header>

      {vista === "captura" ? (
        <main className="bs-shell">
          <div className="bs-body">
            <section className="bs-field">
              <div className="bs-legend">
                <span className="bs-num">01</span>
                <h2 className="bs-label">
                  Tienda <span className="bs-req">*</span>
                </h2>
              </div>
              <div className="bs-inner">
                {tienda ? (
                  <div className="bs-picked">
                    <div>
                      <div className="bs-picked-name">{tienda.nombre}</div>
                      <div className="bs-picked-meta">
                        No. {tienda.numero} · {tienda.cadena}
                      </div>
                    </div>
                    <button
                      className="bs-clear"
                      onClick={() => {
                        setTienda(null);
                        setBusqueda("");
                      }}
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="bs-input"
                      placeholder="Buscar por nombre o número…"
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                      aria-label="Buscar tienda"
                    />
                    <div className="bs-results">
                      {filtradas.map((t) => (
                        <button key={t.id} className="bs-result" onClick={() => setTienda(t)}>
                          <div>{t.nombre}</div>
                          <div className="bs-result-n">
                            No. {t.numero} · {t.cadena}
                          </div>
                        </button>
                      ))}
                      {filtradas.length === 0 && (
                        <div style={{ padding: "14px 12px", fontSize: 13, color: "#5C6660" }}>
                          Sin coincidencias. Revisa el número de tienda.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="bs-field">
              <div className="bs-legend">
                <span className="bs-num">02</span>
                <h2 className="bs-label">
                  Panorámica <span className="bs-req">*</span>
                </h2>
              </div>
              <p className="bs-hint">Todo el mueble o góndola completa, con el pasillo visible.</p>
              <div className="bs-inner">
                <RanuraFoto
                  id="foto-pano"
                  etiqueta="Panorámica"
                  ayuda="Mueble completo"
                  foto={pano}
                  ocupado={cargando.pano}
                  onArchivo={(f) => manejarFoto("pano", f)}
                  onBorrar={() => setPano(null)}
                  ancha
                />
              </div>
            </section>

            <section className="bs-field">
              <div className="bs-legend">
                <span className="bs-num">03</span>
                <h2 className="bs-label">
                  Close-up <span className="bs-req">*</span>
                </h2>
              </div>
              <p className="bs-hint">Producto en anaquel, con etiqueta de precio legible.</p>
              <div className="bs-inner">
                <RanuraFoto
                  id="foto-close"
                  etiqueta="Close-up"
                  ayuda="Producto y precio"
                  foto={close}
                  ocupado={cargando.close}
                  onArchivo={(f) => manejarFoto("close", f)}
                  onBorrar={() => setClose(null)}
                />
              </div>
            </section>

            <section className="bs-field">
              <div className="bs-legend">
                <span className="bs-num">04</span>
                <h2 className="bs-label">Ubicación</h2>
              </div>
              <p className="bs-hint">Se toma sola del GPS del teléfono. No se escribe a mano.</p>
              <div className="bs-inner">
                <div className="bs-gps">
                  <div className="bs-gps-grid">
                    <div>
                      <div className="bs-gps-k">Latitud</div>
                      <div className={"bs-gps-v" + (gps ? "" : " is-muted")}>
                        {gps ? gps.lat.toFixed(5) : "buscando…"}
                      </div>
                    </div>
                    <div>
                      <div className="bs-gps-k">Longitud</div>
                      <div className={"bs-gps-v" + (gps ? "" : " is-muted")}>
                        {gps ? gps.lng.toFixed(5) : "buscando…"}
                      </div>
                    </div>
                    <div>
                      <div className="bs-gps-k">Precisión</div>
                      <div className={"bs-gps-v" + (gps ? "" : " is-muted")}>
                        {gps ? "± " + gps.precision + " m" : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="bs-gps-k">Hora de captura</div>
                      <div className="bs-gps-v">{hora(new Date())}</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="bs-field">
              <div className="bs-legend">
                <span className="bs-num">05</span>
                <h2 className="bs-label">Notas</h2>
              </div>
              <p className="bs-hint">Opcional. Faltantes, material dañado, cambios de acomodo.</p>
              <div className="bs-inner">
                <textarea
                  className="bs-area"
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Ej. Falta Limpiador de Frenos, sin espacio en el exhibidor…"
                  aria-label="Notas"
                />
              </div>
            </section>

            <button className="bs-submit" disabled={!listo} onClick={guardar}>
              Guardar registro
            </button>
            {!listo && (
              <p className="bs-missing">
                Falta {faltan.join(" · ")}
              </p>
            )}
            {listo && (
              <p className="bs-missing" style={{ color: "#5C6660" }}>
                {enLinea
                  ? "Se sube en cuanto lo guardes."
                  : "Se guarda en el teléfono y se sube solo cuando haya señal."}
              </p>
            )}
          </div>
        </main>
      ) : (
        <main className="bs-shell is-wide">
          <div className="bs-body">
            <div className="bs-stats">
              <div className="bs-stat">
                <div className="bs-stat-n">{registros.length}</div>
                <div className="bs-stat-k">Capturados</div>
              </div>
              <div className="bs-stat">
                <div className="bs-stat-n">{sincronizados}</div>
                <div className="bs-stat-k">En servidor</div>
              </div>
              <div className="bs-stat">
                <div className="bs-stat-n" style={{ color: pendientes ? "#C4462B" : undefined }}>
                  {pendientes}
                </div>
                <div className="bs-stat-k">En cola</div>
              </div>
            </div>

            {registros.length === 0 ? (
              <div className="bs-empty">
                <p className="bs-empty-h">Todavía no hay registros</p>
                <p className="bs-empty-p">
                  Captura una exhibición y aparecerá aquí con sus fotos, ubicación y hora real.
                </p>
              </div>
            ) : (
              <div className="bs-rows">
                {registros.map((r) => (
                  <article key={r.id} className="bs-row">
                    <div className="bs-thumbs">
                      <img className="bs-thumb" src={r.pano.url} alt="Panorámica" />
                      <img className="bs-thumb" src={r.close.url} alt="Close-up" />
                    </div>
                    <div>
                      <div className="bs-row-name">{r.tienda.nombre}</div>
                      <div className="bs-row-meta">
                        No. {r.tienda.numero} · {fecha(r.captura)} {hora(r.captura)}
                        <br />
                        {r.gps ? r.gps.lat.toFixed(4) + ", " + r.gps.lng.toFixed(4) : "sin gps"} ·{" "}
                        {kb(r.pano.pesoFinal + r.close.pesoFinal)}
                        {r.subida && r.subida - r.captura > 60000 && (
                          <>
                            <br />
                            Subido {Math.round((r.subida - r.captura) / 60000)} min después
                          </>
                        )}
                      </div>
                      {r.notas && (
                        <div className="bs-row-meta" style={{ color: "#14181B" }}>
                          “{r.notas}”
                        </div>
                      )}
                    </div>
                    <span className={"bs-state " + (r.estado === "pendiente" ? "is-pend" : "is-sync")}>
                      {r.estado === "pendiente" ? "En cola" : "En servidor"}
                    </span>
                  </article>
                ))}
              </div>
            )}

            <p className="bs-note">
              Cada registro guarda la hora real de captura y la hora de subida por separado. Si hay
              horas de diferencia entre las dos, el trabajo se hizo en tienda pero se sincronizó
              después — no es una falla del sistema.
            </p>
          </div>
        </main>
      )}

      <div className="bs-queue">
        <div className="bs-queue-in">
          <div className="bs-queue-l">
            <span className={"bs-queue-n" + (pendientes ? "" : " is-clear")}>
              {String(pendientes).padStart(2, "0")}
            </span>
            <span className="bs-queue-t">
              Pendientes de subir
              <span className="bs-queue-s">
                {pendientes === 0
                  ? "Todo sincronizado"
                  : enLinea
                  ? "Subiendo en segundo plano…"
                  : "Guardados en el teléfono"}
              </span>
            </span>
          </div>
          <button className="bs-toggle" onClick={() => setEnLinea((v) => !v)}>
            {enLinea ? "Simular sin señal" : "Simular con señal"}
          </button>
        </div>
      </div>
    </div>
  );
}