# Bitácora — La Misión (Agentes de Campo)

Registro para retomar el trabajo en cualquier momento. El contexto **permanente**
del proyecto (modelo de dominio, reglas, fases) vive en `CLAUDE.md`; esta bitácora
guarda **qué se decidió y se hizo**, con fechas.

---

## Estado actual (30 ago 2026)

Prototipo **fase 1**. Ya funciona punta a punta:
- Esquema multi-cliente aplicado en Supabase (proyecto `iyduflkognbaxlckngyz`).
- Formulario de captura offline-first en `/captura`, **verificado**: subió una visita
  real con GPS + 2 fotos WebP a Storage y filas en `visitas` / `evidencias`.

---

## Decisiones tomadas (y por qué)

- **Scaffold Astro aplanado a la raíz.** El `npm create astro` lo dejó anidado en
  `astro/`; se subió todo a la raíz para tener un solo proyecto y conservar el
  `CLAUDE.md` bueno.
- **OneDrive dio problemas.** Sincronizando `node_modules` dejó paquetes a medio
  instalar (falló `shiki`, no arrancaba `dev`). Pendiente recomendado: **mover el
  proyecto fuera de OneDrive** (p.ej. `C:\Users\mauda\dev\la-mision`).
- **Env vars con prefijo `PUBLIC_`.** La PWA captura en el cliente, así que la key
  debe llegar al navegador. Se usa la key *publishable* (segura para browser).
- **`.gitignore` endurecido.** Ignora `.env` y `.env.*`, versiona `.env.example`.
  Las llaves reales (`.env.local`) nunca se suben.
- **Integridad multi-tenant a nivel base.** Todas las tablas operativas llevan
  `cliente_id`, y con llaves compuestas `(id, cliente_id)` es imposible que una
  visita apunte a marca/cadena/tienda de otro cliente.
- **Formato de captura configurable por marca** (`marcas.config_captura` jsonb):
  número de fotos, campos y checklist son DATO, no código por cliente.
- **Idempotencia en el sync.** UUID generado en cliente para visita y cada foto +
  `upsert` con `onConflict` → reintentar no duplica.
- **Comprimir fotos en el cliente** (WebP, máx 1600px) antes de encolar — baja
  storage y egress.
- **Migraciones vía `supabase db push` a remoto** (ni SQL Editor ni Docker), para
  mantener el historial de migraciones consistente.
- **RLS off en fase 1 — deuda consciente.** El aviso "RLS Disabled in Public" de
  Supabase es esperado: aislamiento por consulta, no por base. `0003` abre el bucket
  `evidencias` a la key pública para poder subir sin auth. La fase 2 lo cierra.
- **UI sin React.** HTML-first + un script TypeScript (cero dependencias de UI),
  para mantener chico el bundle de la PWA. El `prototipo.md` (React) fue solo
  referencia visual.

---

## Qué se hizo — archivos

**Base de datos (`supabase/`)**
- `migrations/0001_init.sql` — esquema: clientes, marcas, cadenas, tiendas, agentes,
  agente_cliente, visitas, evidencias (con llaves compuestas multi-tenant).
- `migrations/0002_storage.sql` — bucket privado `evidencias`.
- `migrations/0003_acceso_fase1.sql` — policies de Storage para subir en fase 1.
- `migrations/9999_rls_fase2.sql.txt` — RLS por cliente, **gancho de fase 2, sin aplicar**
  (la extensión `.txt` hace que `db push` lo ignore).
- `seed.sql` — plantilla de onboarding (comentada, sin datos reales).
- `seed_demo.sql` — tenant `[DEMO]` de prueba (borrable).

**App (`src/`)**
- `pages/captura.astro` — página `/captura`.
- `pages/prueba-conexion.astro` — diagnóstico de conexión (temporal).
- `styles/captura.css` — diseño (del prototipo).
- `lib/tipos.ts` — tipos del dominio.
- `lib/comprimir.ts` — compresión WebP en cliente.
- `lib/gps.ts` — lectura de GPS.
- `lib/catalogo.ts` — lecturas de Supabase filtradas por `cliente_id`.
- `lib/cola.ts` — cola offline en IndexedDB (guarda blobs).
- `lib/sync.ts` — motor de sync idempotente a Storage + DB.
- `lib/captura-ui.ts` — controlador del formulario.
- `db/supabase.ts` — cliente de Supabase.

---

## Cómo correr

```bash
npm install
npm run dev                 # dev server → http://localhost:4321/captura
```

Base de datos (CLI ya vinculado al proyecto):
```bash
npx supabase db push                                        # aplica migraciones
npx supabase db query --linked -f supabase/seed_demo.sql   # carga tenant [DEMO]
```

Astro 7 corre el dev server en segundo plano: `npx astro dev status | stop | logs`.

---

## Tenant demo

Existe `[DEMO] Cliente de prueba` (marca con 2 fotos, cadena, 2 tiendas, agente).
Para borrarlo (cascade limpia todo lo suyo):
```sql
delete from public.clientes where nombre = '[DEMO] Cliente de prueba';
```

---

## Pendientes (siguiente sesión)

1. **Service Worker / PWA** — instalable, shell cacheado para abrir sin señal, y
   Background Sync para subir la cola aunque la app esté cerrada. (Fase 1.)
2. **Enlazar `index.astro` → `/captura`** (hoy sigue la bienvenida de Astro).
3. **Onboarding de cliente piloto real** (dejar de depender del `[DEMO]`).
4. **Mover el proyecto fuera de OneDrive.**
5. **Fase 2:** auth (Supabase Auth), activar RLS (`9999_rls_fase2.sql.txt`), roles,
   formatos configurables desde UI, reportes por cliente.
