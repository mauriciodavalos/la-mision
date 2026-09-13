# La Misión — Agentes de Campo

Plataforma para que agentes de campo documenten la exhibición de productos en
punto de venta. Cada visita captura GPS, fotos y metadatos de la tienda.
**Funciona sin señal** y sincroniza después.

En producción desde el 30 de agosto de 2026, con agentes reales capturando a
diario.

## Cómo correrlo

```sh
npm install
npm run dev       # servidor local
npm run build     # compila a dist/
npm run prueba    # suite de comportamiento (no necesita navegador)
npx astro check   # tipos
```

Hace falta un `.env.local` con las credenciales de Supabase; la forma está en
`.env.example`. La bandera `PUBLIC_ADMIN=1` habilita las herramientas locales de
administración, que en el sitio publicado no montan nada.

## Las pantallas

| Ruta | Para qué |
|---|---|
| `/` | Índice de accesos |
| `/captura` | La app de los agentes. Es la que se instala en el teléfono |
| `/admin/reportes` | Registros de todas las empresas; corrige la tienda de una visita |
| `/<empresa>/panel` | Tablero de una empresa: cobertura, validación y visitas |
| `/admin/tiendas` | Alta de sucursales por CSV (solo con `PUBLIC_ADMIN=1`) |
| `/prueba-conexion` | Diagnóstico de conexión con Supabase (solo con `PUBLIC_ADMIN=1`) |

## Dónde está lo importante

- **`CLAUDE.md`** — qué es el producto, el modelo del dominio, las reglas
  técnicas no negociables y cómo se trabaja en este repo. **Empieza por ahí.**
- **`BITACORA.md`** — qué se hizo en cada sesión y por qué, con los errores que
  costaron tiempo. Al final, la lista de pendientes.
- **`supabase/migrations/`** — el esquema, en orden. Cada archivo explica sus
  decisiones.
- **`supabase/alta_cliente.sql`** y **`alta_agente.sql`** — el onboarding manual
  de fase 1. La app misma los nombra en pantalla cuando no hay clientes o
  agentes dados de alta.
- **`pruebas/`** — no prueban la UI, prueban las decisiones que son difíciles de
  verificar a mano en un teléfono: la búsqueda de GPS en dos etapas, la
  compresión que no revienta la memoria, cuándo interrumpir al agente con un
  popup, y que el semáforo de validación no pinte verde donde no tiene
  información.

## Estado

Fase 1 (prototipo). Dos clientes piloto. La RLS de Supabase está **apagada** y
el aislamiento entre empresas es por consulta; la key publishable viaja en el
bundle. Es deuda consciente y está documentada en `CLAUDE.md`. La fase 2
(Supabase Auth + RLS) está escrita y sin aplicar en
`supabase/migrations/9999_rls_fase2.sql.txt`.
