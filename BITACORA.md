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
- `alta_agente.sql` — suma un agente a un cliente y le asigna marca y cadena.
- `limpieza_pruebas_fotos.sh` — borra fotos del Storage por lista de rutas, con la
  `service_role` pedida al CLI en el momento. La lista (un archivo de texto, una
  ruta por línea) se escribe para cada limpieza; no se versiona.

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
con clientes reales.

**Sus scripts se borraron del repo el 13 de septiembre**, revirtiendo la decisión
que se había tomado aquí de conservarlos "por si hace falta volver a montar un
entorno de prueba". El motivo del cambio: `seed_demo.sql` insertaba en la MISMA
base que hoy tiene 82 visitas reales de dos clientes. Un script que mete un
tenant falso en producción dejó de ser una comodidad y pasó a ser un riesgo, y la
forma correcta de probar de cero es un proyecto de Supabase aparte. Siguen en el
historial de git si alguna vez hacen falta.

---

## Sesión del 31 de agosto — primer día de captura real

**Sin cambios de código.** No hubo commits ni edits: la sesión fue de observación.
Se sostuvo la decisión del 30 de agosto —dejar que los agentes capturen unos días
antes de tocar nada— y se midió lo que ya hay en la base.

### Qué pasó en campo (consultado en producción el 31 ago, 15:37 hrs CDMX)

**5 visitas y 10 evidencias** (2 fotos cada una, ninguna incompleta):

| Hora (CDMX) | Agente | Cliente / marca @ cadena | Tienda | GPS | Notas |
|---|---|---|---|---|---|
| 10:58 | Lalo | Bikes Shot @ Bodega Aurrerá | BA 1 DE MAYO | sí | "Prueba" |
| 14:30 | Lalo | Bikes Shot @ Bodega Aurrerá | BA FLORES MAGON | sí | "Solo se encuentra LM en exhibición…" |
| 14:32 | Mau | Ondina @ Sanborns | TOREO PARQUE CENTRAL | sí | "Prueba en oficina" |
| 14:33 | Mau | Anframa @ Sanborns | TOREO PARQUE CENTRAL | **no** | "Prueba sin conexion" |
| 14:35 | Mau | Anframa @ Sanborns | ACAPULCO CENTRO | **no** | "Prueba sin conexión 2" |

**La primera visita de campo con contenido real es la de Lalo en BA Flores Magón**
(anotó qué encontró en exhibición). El resto son pruebas deliberadas.

Lo que quedó **confirmado con datos reales**, no en teoría:
- Las rutas legibles del Storage funcionan tal como se diseñaron:
  `bikes-shot/bodega-aurrera/2528-ba-flores-magon-08-31-2026/1430_panoramica_fca28fb7.webp`
  — cliente, cadena, clave+nombre de tienda, fecha local y hora, sin cruzar UUIDs.
- La misma tienda (TOREO PARQUE CENTRAL) recibió visitas de **dos marcas distintas**
  del mismo cliente en el mismo día y quedaron separadas: la visita se ancla a
  tienda + marca, como manda el modelo.
- Dos agentes de dos clientes distintos capturaron el mismo día sin estorbarse.

### Hallazgo a revisar: dos visitas sin coordenadas

Las dos capturas **sin conexión** guardaron `latitud` y `longitud` en `null`. Revisado
el código: `src/lib/gps.ts:25` pide la ubicación con `enableHighAccuracy: true` y
`timeout: 8000`, y **si falla resuelve `null` en silencio** (línea 24). Ocho segundos
de alta precisión bajo techo, sin la asistencia de red (que sí depende de señal), se
quedan cortos — el GPS puro tarda más en fijar. **Es lo correcto para no bloquear al agente** —nunca perder la
evidencia por falta de un dato— pero una visita sin coordenadas vale menos para
auditar exhibición. Hay que decidir entre reintentar la ubicación en segundo plano y
adjuntarla al sincronizar, o al menos avisar al agente en pantalla que se guardó sin
GPS. Se revisa con más datos, no con estas dos.

### Limpieza al cerrar

Se borraron las **4 visitas de prueba** y quedó solo la de Lalo en BA Flores Magón,
la única captura de campo con contenido real. Verificado contra la base y contra el
bucket: **1 visita, 2 evidencias, 2 archivos, 344 KB** — que confirma el estimado de
~380 KB por visita con el que se calculó el consumo del plan gratuito.

Cómo se hizo, para repetirlo:
- Las filas, con un `DELETE` por PostgREST sobre `visitas`. **`evidencias` cae en
  cascada** (`on delete cascade` en `0001`), así que no hay que borrarlas aparte.
- Las fotos, **a mano en el dashboard**. `0003_acceso_fase1.sql` solo da `insert`,
  `select` y `update` sobre el bucket a la key publishable: **no hay policy de
  `delete`**, y no conviene abrirla —esa key va en el bundle público— ni traer la
  `service_role` al disco para tres carpetas.

Van **cuatro veces** que tablas y Storage se desincronizan al limpiar. Sigue sin
justificar código (el borrado es manual y de pruebas), pero cuando lo amerite la
forma correcta es una **Edge Function** que borre los objetos y luego la fila, usando
la `service_role` del lado del servidor. Ver el candidato 5.

### Decisión al cerrar (31 ago)

**No tocar nada todavía.** Un día de uso —con una sola visita de campo genuina— no
alcanza para priorizar. Se mantiene el plan: dejar capturar hasta tener varios días
de Lalo, Carmen y Romina, y con ese volumen decidir. La pantalla de reportes sigue
siendo el candidato número uno.

---

## Sesión del 31 de agosto — panel de administración

Se adelantó el **candidato número uno** de la lista (pantalla de reportes) porque
hizo falta el primer día: sin él, ver el trabajo del equipo obliga a navegar
carpetas del Storage o a consultar la base a mano.

**Ruta: `/admin/reportes`.** A diferencia de `/admin/tiendas`, esta página **sí va
publicada** — se usa desde el teléfono o desde donde sea, no solo en la máquina de
Mauricio con `PUBLIC_ADMIN=1`.

### Qué hace
- **Filtra por empresa y por agente**, más un rango de fechas. El selector de
  agentes se puebla según la empresa elegida.
- **No descarga nada solo.** Al abrir, la pantalla está vacía: hay que elegir y
  tocar **Consultar**. Abrir el panel "por si acaso" no gasta cuota.
- **Fotos bajo demanda**, visita por visita, con URL firmada de una hora — igual
  que el Historial del agente.
- **Botón "Actualizar"** en la barra fija, e interruptor **"auto 1 min"** para
  dejarlo refrescando durante la jornada.
- Resumen arriba: visitas, tiendas, agentes y fotos, con el desglose por agente y
  cuántas visitas quedaron **sin GPS**, que es el hallazgo pendiente del día.

### Decisiones
- **Una empresa a la vez, sin opción de "todas".** Los datos de un cliente no se
  mezclan con los de otro ni en la pantalla del administrador. Al cambiar de
  empresa los resultados se limpian, para que nadie lea cifras de un cliente bajo
  el nombre de otro.
- **El "tiempo real" es sondeo, no websocket.** Supabase Realtime exigiría una
  migración para publicar la tabla y dejaría una conexión abierta por pestaña, a
  cambio de ganar segundos sobre un dato que llega cuando el agente sincroniza.
  El auto-refresco se salta el tick si la pestaña está en segundo plano. El gancho
  para el día que se necesite es `supabase.channel(...)` sobre `visitas`.
- **La puerta es el PIN de agente con `es_admin`**, no una bandera de build. Mismo
  alcance honesto que el resto de fase 1: evita que un agente entre por curiosidad,
  no resiste a quien tenga la key publishable. La cerradura llega con RLS.
- **El filtro de agentes suma a los administradores**, no solo a los miembros de
  `agente_cliente`. Un admin captura en cualquier empresa sin ser miembro: pasó el
  primer día —tres visitas de Mau en Davalos Osio, donde no tiene membresía—, y
  filtrar solo por membresía las habría dejado invisibles.

### Costo
La lista es texto: **~1 KB por cada 10 visitas**. Con el auto-refresco encendido
una jornada de 8 horas son ~480 consultas de texto, del orden de **1 MB** — nada
frente a los 5 GB de egress del plan gratuito. Las fotos, ~200 KB cada una, solo
cuando se piden.

### Archivos
- `src/pages/admin/reportes.astro` — página (nueva).
- `src/lib/admin-reportes-ui.ts` — controlador (nuevo).
- `src/lib/catalogo.ts` — `listarAgentesDeCliente()` (aditivo).
- `src/lib/historial.ts` — `marca_nombre` en la consulta y el tipo (aditivo; el
  Historial del agente no cambia).
- `src/lib/captura-ui.ts` — enlace "panel" en el encabezado, visible solo si el
  agente es admin.
- `src/styles/captura.css` — `.bs-filtros`, `.bs-auto` y el ajuste de 4 columnas.

**Verificado:** `astro check` limpio, `npm run build` pasa con las 5 rutas, el
servidor de desarrollo sirve `/admin/reportes` sin errores, y las dos consultas
nuevas se probaron **contra la base de producción** por PostgREST antes de
escribir la pantalla. Falta la prueba en el teléfono.

---

## Sesión del 31 de agosto — las dos fallas del primer día

Salieron en dos teléfonos distintos, con agentes reales, el mismo día que arrancó
la captura. Las dos estaban en el código desde el principio; hicieron falta ocho
horas de uso real para verlas.

### Falla 1 — visitas sin GPS (teléfono de Carmen)

**Causa:** `refrescarGps()` se llamaba **una sola vez** al montar el formulario,
pedía alta precisión con 8 segundos de límite y, si fallaba, devolvía `null` **en
silencio**. La pantalla se quedaba en "buscando…" aunque ya nadie buscara, y
`faltantes()` no exigía ubicación: la visita se guardaba sin coordenadas. Bajo el
techo de una tienda, ocho segundos de GPS puro no alcanzan para fijar posición.

**Decisión de Mauricio: bloqueo duro.** Sin ubicación no se guarda, sin excepción.

Eso obliga a que el GPS **funcione**, no solo a exigirlo: bloquear sin mejorar la
lectura habría cambiado "visitas sin coordenadas" por "Carmen no puede capturar".
Por eso `gps.ts` se reescribió con tres cambios:

1. **Seguimiento continuo** (`watchPosition`) mientras dura la captura, que
   conserva la **mejor** lectura, no la última. El GPS tiene toda la visita para
   fijar, en vez de ocho segundos al final.
2. **Dos etapas** al pedirla a mano: alta precisión (15 s) y, si no contesta, un
   segundo intento **sin** alta precisión, que usa red y última posición conocida.
   Bajo techo esa segunda etapa es la que responde. Con el permiso bloqueado no
   hay segundo intento: insistir solo hace esperar.
3. **Motivo del fallo** — permiso, no disponible, timeout o sin soporte — con la
   instrucción correspondiente. Para el permiso, la ruta exacta de Ajustes en
   iPhone y Android, porque ahí el navegador ya no vuelve a preguntar solo.

En la pantalla: botón **"Reintentar ubicación"** (que además es el gesto de usuario
que iOS exige para volver a pedir el permiso), y el botón Guardar bloqueado con
"Falta ubicación" mientras no haya.

**Se acepta cualquier precisión.** Arriba de 100 m se avisa, pero no se bloquea:
una lectura de ±300 m sigue diciendo en qué plaza está el agente, y exigir
precisión fina adentro de una tienda es exigir lo que el teléfono no puede dar.

### Falla 2 — "Memoria insuficiente" al tomar la foto (teléfono de Romina)

**Causa:** `comprimir.ts` hacía `createImageBitmap(file)` **sin opciones de
escalado**, o sea decodificaba la foto completa en RAM. Una foto de 12 MP son
~48 MB de bitmap, más el canvas, más el archivo original todavía vivo. El
navegador mataba la pestaña y la recargaba, llevándose lo capturado.

**Arreglo:** escalar **durante** la decodificación, pasándole `resizeWidth` o
`resizeHeight` a `createImageBitmap`. El bitmap pasa de ~48 MB a ~7.7 MB, con la
misma foto de salida. Cuál de los dos lados fijar depende de la orientación, que
se averigua con un sondeo de 64 px que se cierra de inmediato. Además se libera el
bitmap **antes** de codificar el WebP y se deja el canvas en 0×0, que es lo que
suelta su búfer en móviles. Si un navegador no acepta las opciones de escalado,
cae al camino anterior.

De paso, dos cosas que estaban mal alrededor:
- **El error de una foto era invisible:** el `catch` borraba la foto sin decir
  nada. Ahora se explica en el slot, y si fue por memoria lo dice con esas palabras.
- **Fuga de object URLs:** `limpiarFormulario()` no revocaba los previews, así que
  cada visita dejaba dos URLs vivas toda la jornada. La vista Registros no los
  reusa —crea los suyos desde el blob de la cola—, así que revocarlos es seguro.

### Red de seguridad — borrador de la captura

Aunque la causa del crash está corregida, un navegador puede cerrar una pestaña por
muchas razones, y la regla del proyecto es **no perder evidencia nunca**. Cada foto
comprimida se resguarda de inmediato en IndexedDB, junto con tienda, datos y notas.
Al reabrir, la app ofrece **Continuar esa visita** o **Descartar**, y el borrador se
suelta cuando la visita entra a la cola.

- Va en su **propio store**, no en el del catálogo: `olvidarIdentidad()` vacía el
  catálogo al cambiar de agente, y el borrador trae fotos, o sea evidencia.
- Un borrador de **otro agente** se avisa pero **no se borra**.
- `DB_VERSION` sube de 2 a 3, con el mismo patrón aditivo de la migración anterior:
  no toca el store `visitas`, así que una cola con evidencia pendiente sobrevive.
- Se agregó `onblocked` al abrir la base: subir de versión con la app abierta en
  otra pestaña dejaba la promesa colgada para siempre, sin cola y sin explicación.

### Pruebas — `npm run prueba`

`astro check` limpio no prueba nada del comportamiento, y estas dos correcciones
son difíciles de verificar a mano en un teléfono. Se agregaron **17 comprobaciones**
que corren en Node con el navegador simulado (geolocation, createImageBitmap y
canvas), sin dependencias nuevas: usan el esbuild que ya trae Astro.

Cubren lo que de verdad importa: que haya segunda etapa tras un timeout, que no se
insista con el permiso bloqueado, que el seguimiento conserve la mejor lectura, que
una foto vertical fije el alto y una horizontal el ancho, que se cierren los
bitmaps y que el respaldo también entregue 1600 px.

### Service worker

`VERSION` sube a `v2` en `public/sw.js`. Sin eso, un teléfono con la app instalada
puede seguir corriendo el bundle viejo después del deploy — y estos arreglos no
sirven de nada si no llegan al teléfono.

### Archivos

`src/lib/gps.ts` (reescrito), `src/lib/comprimir.ts`, `src/lib/captura-ui.ts`,
`src/lib/cola.ts`, `src/lib/tipos.ts`, `src/styles/captura.css`, `public/sw.js`,
`pruebas/` (nuevo), `package.json`.

Sin migraciones de Supabase: `latitud`/`longitud` siguen aceptando nulos por las
visitas ya guardadas. Volverlas `not null` es tema de fase 2.

---

## Sesión del 1 de septiembre — el crash de memoria NO era la compresión

El arreglo del 31 de agosto no sirvió: el teléfono de Romina seguía reiniciándose
al tomar la foto, con el mismo mensaje.

### Lo que se estaba pasando por alto

El mensaje dice *"Memoria insuficiente para completar la operación **anterior**"*.
Esa es la pantalla de Chrome en Android cuando el sistema **mata el proceso de la
pestaña** — no un error que lance nuestro código.

Y el momento en que ocurre lo explica: `<input type="file" capture>` abre la app
de cámara del sistema, así que **el navegador se va a segundo plano**. La app de
cámara de un teléfono de 12 MP se lleva cientos de MB para su propio pipeline, y
Android libera memoria matando lo que está atrás: la pestaña. El agente da
"aceptar", regresa, y el navegador ya estaba muerto.

**Si es eso, el crash pasa antes de que corra una sola línea nuestra.** Optimizar
`comprimir.ts` no podía arreglarlo: se optimizó el paso correcto, pero el problema
está un paso antes. Quedaban dos hipótesis más —el teléfono nunca recibió el
bundle nuevo, o el navegador cae al respaldo de compresión— y no había forma de
distinguirlas a ciegas.

### Rastro que sobrevive a la muerte de la pestaña — `src/lib/rastro.ts`

Cuando el navegador mata la pestaña se lleva la consola, los logs y todo el estado
en memoria. Por eso cada paso del flujo de foto se apunta ahora en
**localStorage**, que es **síncrono**: cuando `marcar()` regresa, el dato ya está
en disco. IndexedDB no sirve para esto — sus escrituras son asíncronas y una
pestaña que muere en el siguiente instante se las lleva sin guardar.

Al reabrir, la app lee el rastro y **el último paso alcanzado dice cuál hipótesis
era la buena**:

| Último paso | Qué significa | Qué lo arregla |
|---|---|---|
| `camara-abierta` | Murió con la cámara del sistema al frente | Cámara dentro de la app |
| `decodificando` / `codificando` | Sí es la compresión (el detalle dice si usó el respaldo) | Seguir en `comprimir.ts` |
| sin rastro roto | La pestaña no murió; es otra cosa | Volver a empezar |

El aviso se muestra en pantalla con un botón **"Ver detalle"** que enseña el rastro
completo, incluyendo modelo, RAM y **versión de la app**. Nada se manda a ningún
lado: se lee en el teléfono.

### Cámara dentro de la app — `src/lib/camara.ts`

Para la hipótesis de la cámara del sistema no hay arreglo desde la página: hay que
**dejar de salir de la app**. Se abre la cámara con `getUserMedia` sobre un
`<video>` a pantalla completa y al disparar se copia el cuadro a un canvas.

- El navegador **nunca pasa a segundo plano**: no hay nada que Android pueda matar.
- Se pide un cuadro de ~1920 px en vez de una foto de 12 MP: el bitmap que toca la
  memoria es de ~8 MB, no ~48 MB, y **ya sale del tamaño que guardamos igual**
  (1600 px de lado mayor).
- Nunca hay un archivo original vivo en RAM mientras se comprime.

Se pierde detalle contra la foto de 12 MP — que de todos modos tirábamos al
escalar a 1600. Para un anaquel y un acercamiento alcanza, y es la diferencia entre
capturar y no poder capturar.

**Se activa sola** cuando el rastro dice que la caída fue con la cámara del sistema
abierta: el problema es del teléfono, así que la preferencia se guarda por
dispositivo (`localStorage`), no por agente. También hay un interruptor a la vista
—*"Tomar las fotos dentro de la app"*— por si hay que ponerlo a mano. Si la cámara
en la app falla por permiso o falta de soporte, se vuelve sola al modo normal: el
agente nunca se queda sin poder capturar.

**No se hizo el modo por omisión.** Tres de cuatro teléfonos funcionan bien con la
cámara del sistema y esa da mejor foto. Cambiarle el flujo a todos para arreglar
uno sería empeorar lo que ya sirve.

### El respaldo de la compresión era el bug

`decodificarEscalado()` caía a `createImageBitmap(file)` a secas cuando el
navegador no aceptaba las opciones de escalado — o sea, **exactamente la línea que
reventaba la memoria**. El respaldo del arreglo era el bug. Ahora usa `<img>` +
`decode()`, que en Android sí aplica decodificado a escala reducida para JPEG
grandes y no deja un `ImageBitmap` vivo junto al canvas, y revoca su object URL de
inmediato.

### Versión visible

`VERSION_APP` (`v3`) se muestra junto al nombre del agente y va en cada reporte de
caída. Es la única forma de saber a distancia si un teléfono trae el código nuevo o
uno cacheado por el service worker — la hipótesis más barata de descartar y la que
más tiempo hace perder cuando no se descarta.

### Costo

El bundle de captura pasa de 30.9 KB a 38.1 KB. Cero red, cero storage: el rastro
vive en el teléfono. La foto de la cámara en la app pesa lo mismo (~200 KB WebP).

### Archivos

`src/lib/rastro.ts` (nuevo), `src/lib/camara.ts` (nuevo), `src/lib/comprimir.ts`,
`src/lib/captura-ui.ts`, `src/styles/captura.css`, `public/sw.js` (v3),
`pruebas/rastro.prueba.mjs` (nuevo), `pruebas/correr.mjs`,
`pruebas/comprimir.prueba.mjs`. Sin migraciones, sin dependencias nuevas.
`npm run prueba`: 29 comprobaciones.

### Lo que falta saber

Todo esto es instrumentación más una apuesta. **La respuesta la da el teléfono de
Romina:** que abra la app (debe decir `v3`), intente la foto, y si se vuelve a
caer, al reabrir lea el aviso y toque **"Ver detalle"**. Ese texto dice en qué paso
murió, y con eso se sabe si la cámara en la app ya lo resolvió o si hay que buscar
en otro lado.

---

## Sesión del 1 de septiembre — avisos al agente y evidencia que no se desaloja

Salió de dos peticiones de Mauricio (popup al subir un registro, popup cuando falta
la ubicación) y de una pregunta suya que destapó un hueco más serio.

### El hueco que no estábamos viendo

**Al guardar no pasaba nada visible.** `guardar()` encolaba la visita, limpiaba el
formulario y lo volvía a dibujar: desde donde está parado el agente, la pantalla
simplemente se vaciaba. No había confirmación de nada, ni local ni del servidor.
Y la confirmación del servidor **ya existía pero nadie la veía**: `sincronizar()`
marca `sincronizado` sólo cuando Supabase confirmó fotos + visita + evidencias,
pero el evento `cola-cambio` no decía **qué** visita ni si le había ido bien.

### La pregunta que valía más que las dos peticiones

> *"¿Cuándo vuelve a intentar enviar las imágenes? ¿Qué pasaría si cierran la
> pestaña o le vuelven a picar al link?"*

Revisando para contestarla:

- **Reintentos:** al guardar, al volver la señal, cada 30 s, al abrir la app y con
  el botón de la barra. Los cinco viven en la página: **al cerrar la pestaña dejan
  de correr**, y no hay Background Sync a propósito (iOS no lo soporta).
- **Recargar a media subida es seguro**, y esto sí estaba bien resuelto: la ruta de
  cada foto es determinista y sube con `upsert`, y visita y evidencias llevan UUID
  del cliente con `ignoreDuplicates`. El peor caso es resubir ~380 KB; nunca un
  duplicado ni una pérdida. Una visita sale de "pendiente" sólo cuando el servidor
  confirmó las tres cosas.
- **El hueco real: no se pedía `navigator.storage.persist()` en ninguna parte.** Sin
  eso IndexedDB es *best-effort*: un teléfono corto de espacio puede **desalojar los
  datos del origen completos**, con visitas sin subir adentro. Era el único camino
  por el que se podía perder evidencia de verdad — justo en los teléfonos que ya nos
  habían dado problemas.

### Lo que se hizo

**Popup de subida** (`modal.ts`, nuevo). Al guardar se abre con el nombre de la
tienda y espera la confirmación **de esa visita**: verde si el servidor la confirmó,
"queda en cola" si no hay señal o si tarda más de 8 s, y si falla dice que **se
reintenta solo** — nunca como pérdida, porque un agente que cree que se perdió
vuelve a capturar y ahí sí habría duplicados.

**Las confirmaciones tardías NO abren popup.** Si el teléfono recupera señal y sube
tres visitas mientras el agente toma fotos de la cuarta, sale un aviso discreto
abajo. La regla vive en `avisos.ts` como función pura, aparte de la UI, para poder
probarla.

**Popup de ubicación, con la bifurcación que lo hace útil.** El permiso **no se
puede volver a pedir por código** una vez bloqueado: el navegador responde
`PERMISSION_DENIED` sin mostrar diálogo y no hay API para revocarlo. Pero
*bloqueado* y *todavía no contesta* son estados distintos, y `estadoPermiso()` los
distingue — hasta ahora no se usaba para nada:

| Estado | Qué ofrece el popup |
|---|---|
| `prompt` | Botón que abre el diálogo real (necesita el gesto del usuario) |
| `denied` | Los pasos de Ajustes **de su teléfono** (iPhone o Android) y "Ya lo activé" |
| `granted` | Es señal, no permiso: "sigue buscando", el watch ya está corriendo |

Un botón "Permitir" que no funciona la mitad de las veces enseña al agente a
ignorar los avisos.

**El botón Guardar deja de estar deshabilitado.** El bloqueo duro se mantiene
—`guardar()` se niega si falta algo— pero ahora el botón responde y **explica qué
falta**. Un botón gris con letra chica abajo es exactamente lo que no se ve dentro
de una tienda. Y si el GPS falla por permiso, el popup sale solo sin esperar al
final: es el único motivo que no se arregla esperando, y descubrirlo al final es
perder la visita completa.

**Almacenamiento persistente** (`almacen.ts`, nuevo): `persist()` al arrancar, y
aviso si quedan menos de 40 MB —unas cien visitas de margen— antes de que empiecen
a fallar las escrituras, porque cuando fallan lo que se cae es guardar la foto
recién tomada. Más aviso al cerrar la app con registros pendientes.

### Costo

Bundle de captura 37.9 → 45.7 KB. **Cero red y cero storage en el servidor:** todo
se alimenta de eventos que ya se producían; no hay una sola llamada nueva a Supabase.

### Archivos

`src/lib/modal.ts`, `src/lib/almacen.ts`, `src/lib/avisos.ts` (nuevos),
`src/lib/sync.ts` (detalle en `cola-cambio`), `src/lib/gps.ts`
(`instruccionesPermiso()`), `src/lib/captura-ui.ts`, `src/styles/captura.css`,
`public/sw.js` + `rastro.ts` a `v4`, `pruebas/avisos.prueba.mjs` (nuevo).
Sin migraciones, sin dependencias nuevas. `npm run prueba`: 43 comprobaciones.

### Gancho de fase 2

Cuando haya roles y tablero, un fallo de subida debería verse también del lado del
supervisor, no sólo en el teléfono del agente.

---

## Sesión del 4 de septiembre — la primera semana en campo, y corregir sin mentir

### Lo que dijo la base
Romina y Carmen capturan sin problemas: **el crash de memoria está cerrado**. La
cámara dentro de la app (`getUserMedia` en vez de `<input capture>`, v4) era el
diagnóstico correcto.

Auditoría completa contra base **y bucket**, una foto a la vez:

| | |
|---|---|
| Visitas | **26** (31 ago: 1 · 2 sep: 10 · 4 sep: 15) |
| Sin GPS | **0** |
| Con menos de 2 fotos | **0** |
| Faltantes en Storage | **0** de 52 |
| Tamaño distinto entre fila y objeto | **0** |
| Storage | 9.6 MB · 190 KB por foto |

**La cola offline se probó sola, en campo:** la visita de Lalo en BA Bolívar se
capturó 12:19 y subió 13:24 — 65 minutos, íntegra. Las otras 25 subieron en menos
de un minuto. Hasta hoy eso era teoría.

**El GPS es bueno y no verifica nada.** Lecturas repetidas en la misma tienda
coinciden dentro de ±0 a ±14 m (8 tiendas con 2+ visitas), o sea que el
seguimiento continuo funciona. Pero **las 264 tiendas del catálogo tienen
`latitud`/`longitud` en NULL** —los CSV de origen no las traen— así que no se puede
contestar "¿estuvo de verdad en la tienda?", que es lo único que justifica
capturar la coordenada. `importar-tiendas.ts` ya reconoce las columnas: falta el
dato, no el código.

### La equivocación que motivó el trabajo
Carmen capturó una visita en **1075 CENTRO INSURGENTES** cuando era **1006
INSURGENTES** —dos sucursales cuyos puntos observados quedan a **8 metros**— y lo
reportó. Corregirla exigió entrar a la base a mano. Con 264 tiendas eso no es un
proceso: es una llamada de auxilio cada vez.

### Corregir la tienda desde el panel (`corregir-visita.ts` + panel)
Botón **"Corregir tienda"** en cada renglón: busca la sucursal por clave o nombre
sobre el catálogo ya cacheado, muestra un paso de confirmación con las dos
sucursales escritas completas, y escribe. Tres reglas que explican el diseño:

1. **Nunca se reescribe en silencio.** Cada corrección deja su renglón en
   `visitas.datos._correcciones` — campo, de qué a qué (con UUID **y** clave de
   sucursal), quién y cuándo. Sin migración: `datos` ya es jsonb. El renglón se
   marca en rojo en el panel; en un producto de auditoría un dato corregido no
   puede parecer que siempre estuvo así.
2. **La cadena viaja con la tienda.** `visitas` guarda `cadena_id` aparte de
   `tienda_id` y **ninguna llave foránea obliga a que coincidan** (0001 ata cada
   una al cliente, no entre sí). Mover solo la tienda dejaría la visita diciendo
   que ocurrió en una cadena donde esa sucursal no existe: un error silencioso que
   no truena nada y arruina el reporte por cadena. `cadena_id` se toma **siempre**
   de la tienda destino.
3. **Las fotos no se mueven.** `storage_path` conserva el nombre de la tienda
   original. Renombrar la carpeta sería cosmético y mover evidencia en producción
   contradice "nunca perder evidencia"; el panel resuelve por `storage_path`, así
   que no se rompe nada, y el rastro explica la discrepancia.

Además: candado optimista (el UPDATE lleva el `tienda_id` esperado en el WHERE, así
que no pisa un cambio ajeno), y el aislamiento multi-cliente **se verifica en
código**, no se confía en que la búsqueda ya filtró — en fase 1 no hay RLS que lo
detenga después.

### Un error que estaba dormido en las pruebas
`comprimir.prueba.mjs` hacía `globalThis.URL = { createObjectURL, revokeObjectURL }`,
**borrando el constructor real de URL** para todas las suites posteriores. Nadie lo
notó porque ninguna lo usaba. Al agregar `corregir` —cuyo módulo construye el
cliente de Supabase, que valida la URL al importarse— reventó. Ahora el simulacro
**hereda** de la URL real. Los globales que pone una suite se los queda el proceso.

### Cómo se verificó (la lección de las dos regresiones de septiembre)
`astro check` limpio y **65 comprobaciones** en verde no alcanzan: las dos veces que
se rompió algo en producción, las pruebas pasaban. Esta vez se cargó la página
compilada de verdad y se condujo por CDP (WebSocket nativo de Node, sin
dependencias nuevas — ver el patrón en la sesión): sembrar la sesión de admin,
consultar, abrir el corrector, buscar, y **detenerse en «Confirmar cambio» sin
tocarlo**. Resultado: 12 visitas, 12 botones, búsqueda de "insurg" → 3 opciones sin
ofrecer la que la visita ya tiene, cero errores de JS y sin desborde horizontal
(749 de 764 px). Más render a 390 px reales dentro de un iframe, porque **Chrome
headless ignora `--window-size` por debajo de ~500 px** y sin el iframe el
resultado engaña.

### Dos cosas para la operación, no para el código
- **Posible captura repetida:** 1011 Plaza Universidad / Anframa, 4 sep, con **83
  segundos** entre las dos (la primera con nota, la segunda vacía). Si Carmen la
  repitió porque no vio la confirmación, el popup verde no le está quedando claro.
- Tras corregir la de Insurgentes quedan **dos visitas de Anframa en 1006** ese día,
  con notas distintas. Puede ser legítimo o puede sobrar una.

## Sesiones del 11 al 13 de septiembre — lo que no quedó anotado

Tres sesiones de trabajo entraron al repo sin pasar por aquí. Queda el resumen,
porque una bitácora que se atrasa hace creer que el proyecto está a medias
cuando no lo está:

- **Tablero por empresa** en `/<slug>/panel` (reescritura de Netlify, no ruta
  dinámica de Astro: dar de alta una empresa no debe obligar a redesplegar).
- **Validación de visitas** (`validacion.ts`): seis señales con tres estados
  —ok / revisar / **sin-referencia**—, y la tercera nunca se disfraza de verde.
- **`precision_gps`** se medía y se tiraba: la cola la llevaba y `visitas` no
  tenía columna. Migración **0007**; las 82 visitas anteriores quedan en null.
- **Ícono propio** de la app (sw v5) y favicons propios (sw v6).
- **Catálogo de tiendas por empresa** en `/<slug>/tiendas`, con descarga en CSV.
- **Coordenadas de Sanborns**: 141 de 141, más dirección, municipio, estado y CP.
  Migración **0008** (`cp` es TEXT: 45 de 141 empiezan con cero).

---

## Sesión del 15 de septiembre — el padrón nacional de Walmart y Bodega Aurrerá

### Lo que llegó
Mauricio consiguió el padrón completo: **960 tiendas, 622 Bodega Aurrerá y 338
Walmart Supercenter**, con dirección, CP, municipio, estado y **coordenadas**.
Sale del Reporte A de Retail Link (corte al 10-09-2026) y las coordenadas de
Google Places; 808 de 960 con evidencia fuerte, 30 verificadas a mano en el mapa
y 4 corregidas. Con esto se cierra el hueco que llevaba semanas abierto: Bodega
Aurrerá estaba en **0 de 123** sucursales con coordenadas.

Eso cambió una cosa de fondo del catálogo: **Bikes Shot no vende en una cadena,
vende en dos.** El padrón trae la columna Formato, y Walmart Supercenter es una
cadena distinta con sus propias sucursales y su propia clave.

### Lo que se verificó ANTES de escribir
Escribir 960 filas sobre una base con 100 visitas reales encima no se hace a
ciegas. En orden:

1. **Cruce contra las 123 que ya estaban:** las 123 embonan por clave, **ninguna**
   cambió de formato y **ningún nombre difiere**. O sea que el padrón es el mismo
   universo, más grande.
2. **Integridad del propio padrón:** 0 claves repetidas, 0 coordenadas fuera de
   México, 0 filas sin coordenada, los 960 CP de cinco dígitos (49 empiezan con
   cero — de ahí que `cp` sea TEXT).
3. **Contra el GPS de campo**, que es la única referencia independiente que hay:
   de las 18 sucursales con visitas, **15 caen dentro de 300 m** y la mediana es
   de **46 m**. Es el mismo cruce que se le hizo al catálogo de Sanborns.

Las **tres que no cuadran** se diagnosticaron una por una, buscando la tienda del
padrón más cercana a la lectura de campo: en ninguna hay otra sucursal cerca que
explique el punto, y en dos de las tres el padrón es coherente consigo mismo (CP,
municipio y calle apuntan al mismo lugar que la coordenada). O sea que **lo que
hay que revisar es la visita, no el punto**:

| Sucursal | Lectura de campo contra el padrón |
|---|---|
| 1828 BA ACOLMAN TEPEXPAN | **57 km** — la lectura cae por Cuajimalpa; el padrón concuerda con Acolman |
| 3784 BA 1 DE MAYO | **8.3 km** — la lectura cae en Tacubaya; el padrón, en Naucalpan, igual que su CP |
| 3761 BA TULYEHUALCO | **3 km** — el único ambiguo; la lectura quedó a 961 m de Lomas Estrella, visitada una hora antes |

### Lo que se escribió
Cadena nueva **Walmart Supercenter** (slug `walmart-supercenter`), **622 + 338
tiendas** por upsert sobre `(cadena_id, clave_sucursal)` —las mismas semánticas
del importador, así que volver a correrlo actualiza en vez de duplicar— y la
asignación de Lalo a la cadena nueva, sin la cual las 338 no existirían para él.

Verificado después de escribir: **960 tiendas, todas con coordenada, CP y
municipio**, 32 estados, **0 filas cambiaron de id** (las visitas apuntan a esos
ids) y las 21 visitas de Bikes Shot siguen resolviendo, ahora con tienda
georreferenciada.

Los `estado` de las 123 viejas se normalizaron al vocabulario del padrón
("CDMX" → "Ciudad de México", "Estado de Mexico" → "México"). Sin eso el mismo
estado aparecería con dos nombres en el tablero.

### Lo que el dato obligó a cambiar en la app
Con 123 sucursales de CDMX y Edomex, abrir la captura y ver las primeras 20 en
orden alfabético funcionaba. Con 960 de todo el país, **la primera pantalla le
ofrece al agente tiendas de Aguascalientes mientras está parado en Iztapalapa**.
Cargar el padrón sin tocar el buscador habría empeorado la captura en campo.

`buscarTiendas()` ahora ordena **por cercanía a la lectura del GPS antes de
cortar a 20**, y cada renglón dice a qué distancia está. Tres decisiones:

1. **Lo que no tiene coordenada no se esconde**: se va al final. El catálogo de
   un cliente nuevo puede llegar sin puntos y eso no puede dejarlo sin capturar.
2. **Sin GPS todavía**, orden alfabético: es peor no mostrar nada.
3. **Debajo de 50 m dice "aquí mismo"**, no "a 0 m". El GPS del teléfono trae
   ±10 m; poner un número finge una precisión que la lectura no tiene.

La lista se reacomoda sola cuando llega la primera lectura, **una sola vez y
solo si el agente no ha escrito ni elegido nada**: moverle la lista debajo del
dedo sería peor que el orden alfabético.

### Cómo se verificó
`astro check` limpio y **127 comprobaciones** (11 nuevas). Y como en este
proyecto eso ya falló dos veces, se cargó la app **compilada** en Chrome por CDP
con la ubicación simulada en BA Iztapalapa (3764): la lista sale encabezada por
esa tienda con "aquí mismo", siguen Churubusco a 2.9 km y Plaza Oriente a 4.1 km
—las dos cadenas mezcladas por distancia—, buscar "insurgentes" ofrece primero
las dos de CDMX y hasta el final la de Tepic a 645 km, se puede elegir una
tienda, no hay desborde horizontal a 390 px y cero errores de JS.

De paso, el arnés cazó su primer error real: al recargar la página se perdía el
`Emulation.setGeolocationOverride` y la lista salía alfabética. Es exactamente el
síntoma que veríamos en un teléfono sin permiso de ubicación.

### Costo
El catálogo que baja el teléfono de Lalo pasa de ~11 KB a **86 KB**, una vez por
refresco de cache y cacheado en IndexedDB. **Cero llamadas nuevas, cero storage,
cero egress de imágenes** — que es lo caro. Sin dependencias nuevas.

### Archivos
`src/lib/validacion.ts` (`ordenarPorCercania`, `distanciaCorta`),
`src/lib/catalogo.ts` (parámetro `cerca` en `buscarTiendas`),
`src/lib/captura-ui.ts` (distancia en cada renglón y reacomodo al llegar el GPS),
`public/sw.js` + `src/lib/rastro.ts` a **v7**,
`pruebas/validacion.prueba.mjs` (11 comprobaciones nuevas),
`padron_bodega_aurrera.csv` y `padron_walmart_supercenter.csv` (nuevos, ya
probados contra `revisarCSV`: 960 filas válidas, 0 inválidas, 0 campos nulos).
**Sin migraciones**: todas las columnas existían desde 0001 y 0008.

### Gancho de fase 2
Con 960 tiendas y coordenadas, lo que sigue naturalmente es **armar la ruta del
día por distancia real** en vez de por CEDIS —el padrón advierte que el CEDIS es
de donde sale el camión, no dónde está la tienda: el 7464 surte 10 estados—. Y
en el tablero, cobertura por estado, que hoy no se puede ver.

---

### Limpieza de las visitas de prueba (mismo día)

Se borraron **4 visitas de prueba** del agente admin, con sus 8 fotos. Las cuatro
dicen "Prueba …" en la nota y las cuatro se revisaron una por una contra la base
antes de tocarlas:

| id | fecha | tienda | nota |
|---|---|---|---|
| `fd22b691` | 5 sep | 3784 BA 1 DE MAYO | Prueba para corregir |
| `d532601f` | 5 sep | 1028 BUENAVISTA | Prueba para corregir |
| `95f644d0` | 6 sep | 1032 ACAPULCO CENTRO | Prueba sin conexión |
| `1d4b60c6` | 12 sep | 1828 BA ACOLMAN TEPEXPAN | Prueba desierto |

**No se tocaron** las otras dos visitas de Mau (10 sep, 2240 BA Sta Cruz y 1428 BA
San Mateo Atenco): traen notas de exhibición reales. Que una visita sea del admin
no la vuelve una prueba.

**El filtro automático no alcanza para decidir esto.** Buscar "prueba|test|demo…"
en las notas marcó dos visitas de Lalo que son trabajo real: la palabra que
empataba era `demo` dentro de "po**demo**s". Por eso la lista se arma leyendo, no
con una expresión regular.

**Y esto cerró la duda del padrón:** tres de las cuatro pruebas eran justamente las
visitas que no cuadraban con las coordenadas nuevas —Acolman a 57 km, 1 de Mayo a
8.3 km y Acapulco Centro—. Eran capturas hechas desde CDMX con la tienda
equivocada a propósito. **El padrón estaba bien**; queda pendiente preguntarle a
Lalo solo por 3761 Tulyehualco.

Orden seguido, el de siempre: **fotos primero** (`limpieza_pruebas_fotos.sh
--confirmar`, que verifica contra el bucket y no contra el código de salida),
**filas después** (`limpieza_pruebas.sql`, por UUID explícito — nunca por fecha ni
por el texto de la nota, con las agentes capturando a esa misma hora).

**Corte verificado al cerrar:** 96 visitas · 192 evidencias · **36.2 MB**. Cero
visitas sin GPS, cero con menos de dos fotos, **cero filas sin archivo en Storage
y cero archivos huérfanos** (192 objetos en 60 carpetas, cuadra exacto). Las dos
listas (`limpieza_pruebas.sql` y `limpieza_pruebas_fotos.txt`) se borraron del
repo una vez corridas, como la vez pasada.

---

## Dónde retomamos (siguiente sesión)

### Lo que está corriendo ahora mismo
**En producción, con 3 agentes capturando a diario.** Al 15 de septiembre:
**100 visitas, 200 evidencias**, dos fotos por visita sin una sola excepción.
Hoy entraron 15. Los pares que parecen duplicados de Davalos Osio no lo son:
son Ondina y Anframa, dos marcas en la misma tienda.

**El catálogo quedó completo: 960 sucursales de Bikes Shot (Bodega Aurrerá y
Walmart Supercenter) y 141 de Davalos Osio (Sanborns), todas con coordenadas.**

### Lo primero al retomar
**Desplegar.** La base ya tiene las 960 tiendas, pero el buscador por cercanía
vive en el árbol de trabajo: mientras no se suba, el teléfono de Lalo corre v6 y
la primera pantalla le ofrece 20 tiendas del otro lado del país. El orden es
`npm run build` (termina en exit code 9 en Windows, después de escribir `dist`:
si dice "Complete!", salió bien), commit y push a `main`; Netlify despliega solo.

### Candidatos, por orden de valor
1. **Las tres visitas que no cuadran con el padrón** (1828, 3784, 3761).
   Preguntarle a Lalo antes de tocar nada: puede ser tienda equivocada al
   capturar, y para eso está el corrector.
2. **La precisión de GPS de Lalo reporta 1 m** en 4 de sus 5 lecturas con
   `precision_gps`; Carmen y Romina van en 7–11 m, que es lo normal de un
   teléfono. Un "1" clavado es la firma de una app de ubicación simulada. Desde
   la web **no se puede demostrar** (ya se cerró esa pregunta), pero ahora que
   sus tiendas tienen coordenadas, la distancia sí lo va a delatar.
3. **Administrar el catálogo desde la UI.** `/admin/tiendas` solo importa y
   `/<slug>/tiendas` solo lista: no se corrige un nombre ni se da de baja una
   sucursal cerrada. Las altas de agentes y las asignaciones siguen siendo SQL
   —la de Lalo a Walmart Supercenter se hizo a mano en esta sesión—. Con 960
   tiendas y dos clientes ya pesa.
4. **Cobertura por estado en el tablero.** Bikes Shot pasó de 123 a 960
   sucursales: el porcentaje de cobertura contra el padrón nacional ya no dice
   nada útil sin cortarlo por estado o por cercanía a la ruta del agente.
5. **Borrar `/prueba-conexion`**, que era temporal y sigue publicada.
6. **Borrar una visita debería borrar sus fotos.** Se decidió NO hacerlo
   mientras el borrado sea manual y de pruebas (30 ago). Sigue en pie.
7. **Mover el proyecto fuera de OneDrive.**
8. **Fase 2:** Supabase Auth (que **sustituye** al PIN, no convive con él), RLS
   (`9999_rls_fase2.sql.txt`, ya listo y sin aplicar), formatos configurables
   desde UI, reportes por cliente, facturación.

### Costos que hay que vigilar
- **Storage:** ~380 KB por visita. El plan gratuito da 1 GB; con el ritmo real
  (7.7 visitas/día) el margen es de casi un año. No urge mover nada a R2.
- **Catálogo:** 86 KB por refresco en el teléfono de Lalo. Si un cliente llega
  con miles de sucursales, habrá que traer solo su zona.
- **Pausado por inactividad:** Supabase duerme el proyecto a los 7 días sin
  actividad. Mientras capturen a diario, no aplica.
