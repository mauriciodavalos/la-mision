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

**El sistema está EN PRODUCCIÓN y probado en teléfono.** Migraciones `0001`–`0006`
aplicadas. `astro check` limpio, `npm run build` pasa, desplegado en Netlify.

**Verificado en campo por Mauricio (30 ago):** el PIN funciona, el selector de
marca funciona, y **la captura offline funciona**. Se capturaron 4 visitas de
prueba reales (3 en Bodega Aurrerá, 1 en Sanborns) que subieron con sus fotos.

**Quién opera hoy:**

| Agente | PIN | Empresa | Captura |
|---|---|---|---|
| Lalo | 0001 | Bikes Shot | Bikes Shot @ Bodega Aurrerá (123 tiendas) |
| Carmen | 0003 | Davalos Osio | Ondina y Anframa @ Sanborns (141 tiendas) |
| Romina | 0004 | Davalos Osio | Ondina y Anframa @ Sanborns |
| Mau | 0002 | — | **ADMIN**: todas las marcas y puntos de venta |

**Datos en la base:** 2 clientes, 3 marcas, 2 cadenas, **264 tiendas**, 4 agentes,
5 asignaciones. El tenant `[DEMO]` ya se borró.

**Las visitas están en CERO a propósito:** las 4 de prueba se borraron al cerrar la
sesión. Lo que se capture de aquí en adelante es dato de producción.

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
- **Identidad del agente con PIN de 4 dígitos (fase 1).** Antes el agente salía de
  un dropdown sin verificar: cualquiera capturaba a nombre de cualquiera. Ahora se
  identifica una vez por dispositivo y valida el PIN **sin señal** (WebCrypto contra
  el catálogo cacheado). Se guarda solo `sha256(pin||salt)`.
  *Alcance honesto:* el hash es público y 4 dígitos se rompen por fuerza bruta en
  segundos. Sirve contra capturar con el nombre equivocado, no contra un atacante.
  La identidad real es fase 2 (Supabase Auth + RLS).
- **Se eliminó la dependencia de `clientes[0]`.** El cliente ya no se adivina por
  orden alfabético: lo fija la identidad guardada, y si hay varios se elige al
  identificarse. Además el header muestra siempre agente y cliente.
- **Catálogo cacheado en IndexedDB** (`DB_VERSION` 1 → 2, aditivo). Sin esto la app
  no tenía catálogo sin señal. De paso la búsqueda de tiendas es local: instantánea
  y sin pegarle a la red en cada tecla (menos egress).
- **Tiendas por CSV, no por SQL.** El catálogo de tiendas es lo que crece, así que
  tiene que poder cargarse sin escribir SQL. Parseo propio (~90 líneas) en vez de
  meter una dependencia al bundle de la PWA. `upsert` sobre
  `(cadena_id, clave_sucursal)`: reimportar actualiza, no duplica.
- **`/admin/*` detrás de `PUBLIC_ADMIN`**, definido solo en `.env.local` y no en
  Netlify. *Honestidad:* con RLS apagada y la key publishable en el bundle, quien la
  tenga puede escribir en `tiendas` exista o no la página. La bandera evita dejar la
  herramienta a la vista; la cerradura es fase 2.
- **Service Worker sin Background Sync.** iOS no lo soporta y `sync.ts` ya reintenta
  con el evento `online` más un intervalo de respaldo. Menos piezas que fallen.
  El SW **nunca** cachea llamadas a Supabase: el catálogo tiene su propio cache.

- **Rutas del Storage legibles, por slug (`0005_slugs.sql`, `sync.ts -> rutaFoto`).**
  Antes era `{cliente_id}/{visita_id}/{foto_id}.webp`: imposible entender el bucket
  sin cruzar UUIDs a mano. Ahora:
  `bikes-shot/bodega-aurrera/3784-ba-1-de-mayo-08-30-2026/1639_panoramica_adc9fffd.webp`
  - Cliente y cadena van por **slug**, no por nombre: el slug es estable, así que
    renombrar la empresa no parte las carpetas ya escritas.
  - La tienda lleva la **clave primero** (`3784-…`): es la llave del retailer y no
    cambia, mientras el nombre sí; de paso ordena por número.
  - La **fecha (mm-dd-aaaa) va en la carpeta de la tienda**, a pedido de Mauricio:
    cada visita a una tienda en un día queda en su propia carpeta. Con guiones, no
    diagonales — en Storage una `/` crea carpetas anidadas. La **hora** va en el
    archivo, para distinguir dos visitas a la misma tienda el mismo día.
    *Nota:* `mm-dd-aaaa` no ordena cronológicamente al listar (agrupa por mes entre
    años distintos). Se eligió así por legibilidad; `aaaa-mm-dd` sí ordenaría.
  - La fecha se calcula en **America/Mexico_City** desde `capturada_en`, no en UTC:
    una visita a las 20:00 CDMX no debe caer en la carpeta del día siguiente.
  - Se incluye la **cadena** porque `clave_sucursal` es única dentro de una cadena,
    no dentro del cliente: dos cadenas del mismo cliente podrían chocar.
  - El **id corto de la foto** al final conserva la idempotencia: la ruta es la
    misma para la misma foto, así que reintentar sobrescribe en vez de duplicar.
  - Una visita encolada ANTES del cambio sube con la ruta vieja por UUID en vez de
    fallar (respaldo en `rutaFoto`). Nunca perder evidencia.
  - El mismo slug sirve para la URL por empresa, que era el otro pendiente.

- **Retención en la cola local (`retencion.ts`).** La cola nunca soltaba nada:
  `cola.eliminar()` existía pero no se llamaba desde ningún lado, así que las fotos
  se quedaban completas en el teléfono para siempre (~380 KB por visita, ~230 MB al
  mes con 20 visitas diarias) hasta que el navegador rechazara escrituras por cuota
  — rompiendo justo lo que no puede fallar. Política:
  1. Visita **no confirmada**: intocable, sin importar su edad. Sin excepciones.
  2. Confirmada + **48 h**: se sueltan los blobs (ya están en Supabase). El registro
     sigue visible con tienda, hora y GPS; solo pierde la miniatura.
  3. Confirmada + **30 días**: se borra el registro local.
  Corre al arrancar y después de cada sync, más un botón "liberar espacio ahora".
  `subirVisita` lanza si encuentra una foto sin blob, para nunca pisar con un
  archivo vacío el que ya está bien en el servidor.
- **Pestaña Historial (`historial.ts`).** Consulta las visitas al servidor por
  rango de fechas, con filtro "solo mis visitas". Es lo que permite que la cola
  local sea corta. **Las fotos NO se cargan solas**: la lista es texto (unos KB) y
  cada foto son ~200 KB de egress, así que se piden visita por visita al tocar
  "ver fotos", con URL firmada de una hora (el bucket es privado). Si se cargaran
  las miniaturas de todo, una semana de trabajo serían decenas de MB por cada vez
  que alguien abre la pestaña.
  La pestaña "Registros" se renombró a **"En el equipo"** para que quede claro que
  muestra lo local, no lo que hay en el servidor — esa confusión ya costó una duda.

- **Asignaciones y rol de admin (`0006_asignaciones.sql`).** Un agente ligado a un
  cliente veía TODO lo suyo: todas las marcas y las 123 tiendas. La operación real
  es otra: Lalo hace Bodega Aurrerá para Bikes Shot; Carmen hace Sanborns para
  Ondina y Anframa (dos marcas del mismo cliente); Mau administra todo.
  - `agente_asignacion (agente, cliente, marca, cadena)` con llaves compuestas: es
    imposible asignar la marca de un cliente en la cadena de otro. **Probado** con
    un insert cruzado que la base rechaza.
  - Granularidad **marca + cadena completa**, no tienda por tienda: así las
    sucursales nuevas cargadas por CSV aparecen solas para quien ya tiene esa
    cadena, sin el paso manual que se olvida y deja a un agente sin sus tiendas.
  - `agentes.es_admin` se salta asignaciones y membresía. Bandera y no tabla de
    roles porque en fase 1 solo hay dos niveles.
  - `agente_cliente` se queda como **membresía** (dónde puede identificarse);
    `agente_asignacion` es el **alcance** (qué captura).
  - **Se corrigió el `marcas[0]`**, gemelo del bug de `clientes[0]`: con varias
    marcas asignadas ya no se elige la primera por orden alfabético — el agente
    tiene que elegir. Si no, Carmen habría capturado siempre en Anframa sin darse
    cuenta y la evidencia quedaría mal atribuida hasta el reporte, o nunca.
  - Las llaves del cache llevan el id del agente: en un equipo compartido, Carmen
    no debe ver el catálogo cacheado de Lalo.

- **La identificación empieza por el AGENTE, no por la empresa.** Al probarlo en
  campo, Mauricio reportó que elegir primero la empresa era confuso: el agente sabe
  cómo se llama, no necesariamente para qué razón social está dado de alta.
  Ahora: nombre → (empresa, solo si atiende a más de una) → PIN. Con una sola
  empresa no se le pregunta, solo se le muestra cuál es. El PIN aparece hasta que
  hay agente y empresa, para que no se teclee antes de tiempo.
  Implica que `listarAgentes()` es global en vez de por cliente. En fase 1 eso no
  expone nada nuevo: la key publishable ya permite leer la tabla completa.

### Pendiente de decidir — una base de datos por cliente
Se planteó dar URL y base independientes por marca. Análisis: **URL por cliente sí**
(slug → `cliente_id`; barato, y de paso fija el tenant), **base por cliente no**:
Supabase da 2 proyectos gratis y de ahí son $25 USD/mes por cliente, cada uno se
pausa por inactividad, las migraciones se multiplican, y el agente multi-cliente
acaba con dos apps y dos colas offline. El aislamiento se resuelve con RLS en fase 2.
El esquema queda listo para extraer un tenant por `cliente_id` el día que un cliente
grande lo exija y lo pague.

---

## Qué se hizo — archivos

**Base de datos (`supabase/`)**
- `migrations/0001_init.sql` — esquema: clientes, marcas, cadenas, tiendas, agentes,
  agente_cliente, visitas, evidencias (con llaves compuestas multi-tenant).
- `migrations/0002_storage.sql` — bucket privado `evidencias`.
- `migrations/0003_acceso_fase1.sql` — policies de Storage para subir en fase 1.
- `migrations/0004_pin_agente.sql` — `pin_salt`/`pin_hash` en `agentes` + función
  `set_pin_agente(agente, pin)`. **Sin aplicar todavía.**
- `migrations/9999_rls_fase2.sql.txt` — RLS por cliente, **gancho de fase 2, sin aplicar**
  (la extensión `.txt` hace que `db push` lo ignore).
- `alta_cliente.sql` — onboarding parametrizado y re-ejecutable: cliente → marca →
  cadena → agentes → membresía → PIN. Se llena el bloque "LLENA ESTO" y se corre.
  Los nombres reales viven en la base, no en el repo.
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
- `lib/catalogo-cache.ts` — cache del catálogo en IndexedDB (`redPrimero`).
- `lib/identidad.ts` — verificación del PIN (WebCrypto) y sesión del agente.
- `lib/identidad-ui.ts` — pantalla "¿Quién captura?" (agente + PIN).
- `lib/importar-tiendas.ts` — parseo y validación de CSV + escritura idempotente.
- `lib/admin-tiendas-ui.ts` — controlador del importador.
- `pages/admin/tiendas.astro` — importador de tiendas (tras `PUBLIC_ADMIN=1`).
- `db/supabase.ts` — cliente de Supabase.

**PWA (`public/`)**
- `manifest.webmanifest` — instalable. *Pendiente:* iconos PNG propios (hoy usa el
  `favicon.svg`; Chrome lo acepta, iOS lo muestra pobre).
- `sw.js` — precache del shell, red primero en navegación, cache primero en assets.
  Nunca cachea Supabase.

---

## Sesión del 30 de agosto — commits

En orden. Cada commit trae en su mensaje el porqué a detalle.

| Commit | Qué |
|---|---|
| `a002c35` | Identidad con PIN, catálogo offline, importador CSV, Service Worker |
| `80d5ed8` | Rutas de Storage legibles por slug de cliente y cadena |
| `fba7919` | La fecha de captura va en la carpeta de la tienda |
| `3b4f2df` | Retención de la cola local (48 h) y pestaña de Historial |
| `6b965a5` | Asignación por marca y cadena, y rol de administrador |
| `72f81e0` | El importador acepta `nombre_interno` como columna de nombre |
| `0b3e952` | La identificación empieza por el agente, no por la empresa |
| `d647995` | Fuera el botón de liberar espacio; contraste de "Ver fotos" |

**Migraciones aplicadas hoy:** `0004` (PIN), `0005` (slugs), `0006` (asignaciones).

**Tres bugs latentes encontrados y cerrados**, todos de la misma familia — adivinar
un valor cuando hay varias opciones:
- `clientes[0]`: el cliente salía del primero por orden alfabético.
- `marcas[0]`: lo mismo con la marca. Con Ondina y Anframa, Carmen habría capturado
  siempre en Anframa sin darse cuenta.
- La cola local nunca soltaba nada: `cola.eliminar()` existía pero no se llamaba
  desde ningún lado. El teléfono se habría llenado hasta romper la captura.

**Dos bugs del importador**, encontrados con archivos reales: `No. Tienda` no
empataba por el punto, y `nombre_interno` no estaba en los sinónimos — habría
cargado las 141 sucursales de Sanborns sin nombre.

---

## Cómo correr

```bash
npm install
npm run dev                 # dev server → http://localhost:4321/captura
```

Para las herramientas de administración, en `.env.local`: `PUBLIC_ADMIN=1`
→ http://localhost:4321/admin/tiendas (importador de tiendas por CSV).
**No definir `PUBLIC_ADMIN` en Netlify.**

OJO al probar en el celular: el PIN se valida con WebCrypto, que solo existe en
contexto seguro. Por `http://192.168.x.x` no funciona — usa un túnel https o
prueba en el sitio de Netlify.

Base de datos (CLI ya vinculado al proyecto):
```bash
npx supabase db push                                         # aplica migraciones
npx supabase db query --linked -f supabase/alta_cliente.sql  # alta de empresa + marca + cadena + agente
npx supabase db query --linked -f supabase/alta_agente.sql   # sumar agente y asignarle marca/cadena
npx supabase db query --linked -f supabase/limpieza_demo.sql # borrar el tenant de prueba
```

Storage por CLI (experimental, pero funciona):
```bash
npx supabase storage ls "ss:///evidencias/" --linked --experimental -r
npx supabase storage mv "ss:///evidencias/<origen>" "ss:///evidencias/<destino>" --linked --experimental
```
Ojo: el CLI **no** borra archivos que empiezan con punto (`.emptyFolderPlaceholder`);
esos se quitan desde el dashboard.

Al limpiar visitas de prueba, **el orden importa**: primero borrar las carpetas en
el dashboard, luego `delete from public.visitas;`. Al revés, las fotos se quedan
huérfanas ocupando cuota. (Decidido el 30 ago: se hace a mano, sin trigger.)

Astro 7 corre el dev server en segundo plano: `npx astro dev status | stop | logs`.

---

## Tenant demo — ya borrado

`[DEMO] Cliente de prueba` se eliminó el 30 de agosto, una vez verificado el flujo
con clientes reales. El seed (`seed_demo.sql`) y el script de limpieza
(`limpieza_demo.sql`) se quedan en el repo por si hace falta volver a montar un
entorno de prueba desde cero.

---

## Dónde retomamos (siguiente sesión)

### Lo que está corriendo ahora mismo
**Lalo, Carmen y Romina están capturando en campo.** La decisión al cerrar la
sesión del 30 de agosto fue **dejarlos trabajar unos días antes de tocar nada**:
se aprende más de tres días de uso real que de adivinar mejoras en el escritorio.

**Primera pregunta al retomar:** ¿qué pasó en campo? Antes de proponer nada,
revisar cuántas visitas hay, de quién, con cuántas fotos, y si hay visitas atoradas
en estado `error`:

```bash
npx supabase db query --linked "select a.nombre, c.nombre as cliente, count(*) as visitas, min(v.capturada_en) as primera, max(v.capturada_en) as ultima from visitas v join agentes a on a.id=v.agente_id join clientes c on c.id=v.cliente_id group by 1,2 order by 1;"
```

Con eso en la mano se decide qué sigue. Lo de abajo es la lista de candidatos, no
un compromiso.

### Candidatos, por orden de valor
1. **Pantalla de reportes.** Es lo que más falta va a hacer en cuanto haya volumen:
   visitas por tienda y por fecha, con sus fotos. Navegar carpetas del Storage no
   escala; el Historial sirve al agente, no a quien administra. Mauricio ya lo
   pidió implícitamente dos veces ("¿dónde veo…?").
2. **Pantalla para administrar el catálogo.** Hoy `/admin/tiendas` solo IMPORTA:
   no lista, no busca, no corrige un nombre mal escrito ni da de baja una sucursal
   cerrada. Y las altas de agentes y asignaciones son por SQL. Con 2 clientes se
   aguanta; con el tercero, no.
3. **Smoke test del importador CSV.** Las dos cargas (123 + 141 tiendas) se
   hicieron por SQL generado, así que `/admin/tiendas` **nunca se ha ejercitado
   contra la base**. Correrlo con `PUBLIC_ADMIN=1` y reimportar el mismo CSV: no
   debe duplicar.
4. **URL por cliente** (slug → `cliente_id`). Los slugs ya existen (`bikes-shot`,
   `davalos-osio`); falta resolver el tenant desde la URL. Le da a cada empresa su
   dirección y quita el selector de empresa para el admin.
5. **Borrar una visita debería borrar sus fotos.** Van tres veces que tablas y
   Storage se desincronizan al limpiar. **Se decidió NO hacerlo por ahora** (30
   ago): mientras el borrado sea manual y de pruebas, el orden correcto —primero
   las carpetas en el dashboard, luego el `delete` en SQL— es suficiente. Retomar
   si aparece evidencia inconsistente con datos reales.
6. **Iconos PNG del manifest** (192 y 512 px) para que instale bien en iOS.
7. **Enlazar `index.astro` → `/captura`** (hoy sigue la bienvenida de Astro) y
   borrar `/prueba-conexion`, que era temporal.
8. **Mover el proyecto fuera de OneDrive.**
9. **Fase 2:** Supabase Auth (que **sustituye** al PIN, no convive con él), activar
   RLS (`9999_rls_fase2.sql.txt`, ya actualizado para slugs, asignaciones y admin),
   formatos configurables desde UI, reportes por cliente, facturación.

### Costos que hay que vigilar
- **Storage:** ~380 KB por visita (2 fotos WebP). El plan gratuito da 1 GB ≈ **2,600
  visitas**. Con 3 agentes a 20 visitas diarias, ~2 meses. La salida barata es
  Cloudflare R2, que no cobra egress.
- **Pausado por inactividad:** el proyecto de Supabase se duerme a los 7 días sin
  actividad. Mientras los agentes capturen a diario no aplica; si paran, sí.
