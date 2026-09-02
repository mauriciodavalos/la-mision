// Service Worker de La Misión — que la app ABRA sin señal.
//
// Sin esto, "funciona offline" solo aplica mientras la pestaña siga abierta: si el
// agente cierra la app dentro de una tienda sin cobertura, ya no vuelve a entrar.
// Con esto, el shell (HTML, CSS, JS) se sirve desde cache y la captura arranca
// aunque no haya red.
//
// Reglas de diseño:
//  * NUNCA cachear llamadas a Supabase. El catálogo tiene su propio cache en
//    IndexedDB (catalogo-cache.ts), con su lógica de frescura; servir respuestas
//    viejas de la API desde aquí solo causaría datos inconsistentes.
//  * Nada de Background Sync: iOS no lo soporta, y sync.ts ya reintenta con el
//    evento `online` y un intervalo de respaldo. Menos piezas que fallen.
//  * Cache versionado: al cambiar VERSION se borran las anteriores en `activate`.
//
// Costo: baja el egress. El shell deja de descargarse en cada visita.

// v3 (1 sep 2026): cámara dentro de la app y rastro de caídas. El crash de
// memoria seguía apareciendo con v2, y el rastro sirve justamente para saber si
// un teléfono está corriendo el bundle nuevo o uno cacheado.
// v2 (31 ago 2026): ubicación obligatoria, compresión que no revienta la memoria
// del teléfono y borrador de la captura. Subir la versión es lo que hace que un
// teléfono con la app instalada tome el bundle nuevo en vez del cacheado.
const VERSION = "v3";
const CACHE = `lamision-shell-${VERSION}`;

// Lo mínimo para arrancar. Los assets con hash (/_astro/*) se cachean solos al
// vuelo la primera vez que cargan, así que no hay que enumerarlos aquí (y no se
// puede: sus nombres cambian en cada build).
const PRECACHE = ["/captura"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      // Si algo del precache falla (p.ej. build en caliente), no romper la instalación.
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ¿Se puede cachear? Solo GET del propio origen, más las fuentes de Google
// (si no, sin señal la app se ve con tipografías de sistema).
function cacheable(url, request) {
  if (request.method !== "GET") return false;
  if (url.origin === self.location.origin) {
    // La API de Supabase nunca pasa por aquí, pero por si se sirve tras un proxy:
    return !url.pathname.startsWith("/rest/") && !url.pathname.startsWith("/storage/");
  }
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

self.addEventListener("fetch", (evento) => {
  const request = evento.request;
  const url = new URL(request.url);

  // Todo lo demás (Supabase: catálogo, subida de fotos) va directo a la red.
  if (!cacheable(url, request)) return;

  // Navegación: red primero para traer la versión nueva cuando hay señal, y
  // cache como respaldo para que la app abra sin ella.
  if (request.mode === "navigate") {
    evento.respondWith(
      fetch(request)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(request, copia));
          return resp;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(request)) ||
            (await cache.match("/captura")) ||
            Response.error()
          );
        })
    );
    return;
  }

  // Assets: cache primero (los de Astro llevan hash, así que no se quedan viejos),
  // y se guardan al vuelo la primera vez.
  evento.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((resp) => {
          if (resp.ok || resp.type === "opaque") {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(request, copia));
          }
          return resp;
        })
        .catch(() => hit || Response.error());
    })
  );
});
