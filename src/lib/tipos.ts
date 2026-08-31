// Tipos del dominio compartidos por el flujo de captura.

export interface Cliente {
  id: string;
  nombre: string;
  // Identificador estable para rutas de Storage y URL por empresa (ver 0005_slugs.sql).
  slug: string;
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
  slug: string;
}

export interface Tienda {
  id: string;
  cliente_id: string;
  cadena_id: string;
  clave_sucursal: string;
  nombre: string | null;
  cadena_nombre?: string; // resuelto en el join para mostrar
  cadena_slug?: string;   // resuelto en el join, para armar la ruta de Storage
}

export interface Agente {
  id: string;
  nombre: string;
  // Admin: se salta las asignaciones y la membresía — ve y captura en todo
  // (ver 0006_asignaciones.sql).
  es_admin?: boolean;
  // Credencial de fase 1 (ver 0004_pin_agente.sql). Viajan al navegador a
  // propósito: el PIN se valida SIN SEÑAL contra el catálogo cacheado.
  // Van nulos mientras el agente no tenga PIN asignado.
  pin_salt?: string | null;
  pin_hash?: string | null;
}

// Qué marca captura un agente, en qué cadena (ver 0006_asignaciones.sql).
export interface Asignacion {
  marca_id: string;
  cadena_id: string;
}

// Agente identificado en ESTE dispositivo (se guarda en localStorage).
export interface Identidad {
  cliente_id: string;
  agente_id: string;
  agente_nombre: string;
  desde: string; // ISO UTC — cuándo se identificó
}

// ---- Datos locales (cola offline) ----

export interface FotoLocal {
  id: string;            // UUID generado en el cliente (idempotencia)
  tipo: string;          // referencia al SlotFoto.tipo de la config
  // La imagen comprimida. Se LIBERA (queda undefined) 48 h después de que el
  // servidor confirmó la visita, para no llenar el teléfono — la foto ya vive en
  // Supabase. Ver retencion.ts. Mientras la visita no esté confirmada, el blob
  // NUNCA se toca.
  blob?: Blob;
  liberada?: boolean;    // true si el blob se soltó por retención
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
  // Copias para armar la ruta legible del Storage sin depender de la red al
  // momento de subir (ver sync.ts -> rutaFoto). Opcionales: una visita encolada
  // ANTES de este cambio no las trae, y el sync cae a la ruta vieja por UUID.
  cliente_slug?: string;
  cadena_slug?: string;
  // Estado local de sincronización:
  estado: "pendiente" | "sincronizado" | "error";
  ultimo_error?: string;
  creada_en: string;     // ISO UTC
  subida_en?: string;    // ISO UTC — cuándo confirmó el servidor
}
