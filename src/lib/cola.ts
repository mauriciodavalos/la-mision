// Cola offline en IndexedDB. Guarda las visitas pendientes CON sus blobs de foto,
// así sobreviven a recargas, cierre de la app y falta de señal.
//
// Regla de oro: una visita sale de la cola SOLO cuando el servidor confirma que
// se guardó (ver sync.ts -> eliminar()). Mientras tanto, nunca se pierde evidencia.

import type { VisitaPendiente } from "./tipos";

const DB_NOMBRE = "lamision-cola";
const DB_VERSION = 1;
const STORE = "visitas";

let dbPromise: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, modo: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, modo).objectStore(STORE);
}

export async function guardar(v: VisitaPendiente): Promise<void> {
  const db = await abrir();
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, "readwrite").put(v);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function listar(): Promise<VisitaPendiente[]> {
  const db = await abrir();
  const todas = await new Promise<VisitaPendiente[]>((resolve, reject) => {
    const req = tx(db, "readonly").getAll();
    req.onsuccess = () => resolve(req.result as VisitaPendiente[]);
    req.onerror = () => reject(req.error);
  });
  // Más recientes primero (por hora real de captura).
  return todas.sort((a, b) => b.creada_en.localeCompare(a.creada_en));
}

export async function obtener(id: string): Promise<VisitaPendiente | undefined> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly").get(id);
    req.onsuccess = () => resolve(req.result as VisitaPendiente | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function eliminar(id: string): Promise<void> {
  const db = await abrir();
  await new Promise<void>((resolve, reject) => {
    const req = tx(db, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
