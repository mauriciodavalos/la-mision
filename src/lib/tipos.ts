// Tipos del dominio compartidos por el flujo de captura.

export interface Cliente {
  id: string;
  nombre: string;
}

export interface Marca {
  id: string;
  cliente_id: string;
  nombre: string;
  config_captura: ConfigCaptura;
}

// El formato de captura es DATO configurable por marca (no código por cliente).
export interface ConfigCaptura {
  fotos: SlotFoto[];
  campos: CampoExtra[];
  checklist: ItemChecklist[];
}

export interface SlotFoto {
  tipo: string;          // clave estable, p.ej. "panoramica" | "acercamiento"
  etiqueta: string;      // texto visible
  obligatoria: boolean;
  ayuda?: string;        // hint bajo la ranura
  ancha?: boolean;       // relación 16/9 en vez de 4/3
}

export interface CampoExtra {
  clave: string;
  etiqueta: string;
  tipo: "texto" | "numero" | "seleccion";
  opciones?: string[];
  obligatorio?: boolean;
}

export interface ItemChecklist {
  clave: string;
  etiqueta: string;
}

export interface Cadena {
  id: string;
  cliente_id: string;
  nombre: string;
}

export interface Tienda {
  id: string;
  cliente_id: string;
  cadena_id: string;
  clave_sucursal: string;
  nombre: string | null;
  cadena_nombre?: string; // resuelto en el join para mostrar
}

export interface Agente {
  id: string;
  nombre: string;
}

// ---- Datos locales (cola offline) ----

export interface FotoLocal {
  id: string;            // UUID generado en el cliente (idempotencia)
  tipo: string;          // referencia al SlotFoto.tipo de la config
  blob: Blob;            // imagen ya comprimida a WebP
  ancho: number;
  alto: number;
  bytes: number;
  bytesOriginal: number;
}

export interface VisitaPendiente {
  id: string;            // UUID generado en el cliente (idempotencia en el sync)
  cliente_id: string;
  marca_id: string;
  cadena_id: string;
  tienda_id: string;
  agente_id: string;
  capturada_en: string;  // ISO UTC — hora real en el dispositivo
  latitud: number | null;
  longitud: number | null;
  precision_gps: number | null;
  datos: Record<string, unknown>; // respuestas de campos/checklist configurables
  notas: string;
  fotos: FotoLocal[];
  // Copias para mostrar en "Registros" sin volver a consultar la red:
  tienda_nombre: string;
  tienda_clave: string;
  // Estado local de sincronización:
  estado: "pendiente" | "sincronizado" | "error";
  ultimo_error?: string;
  creada_en: string;     // ISO UTC
  subida_en?: string;    // ISO UTC — cuándo confirmó el servidor
}
