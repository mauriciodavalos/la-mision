# La Misión — Agentes de Campo

Contexto permanente para cualquier sesión de Claude que trabaje en este repo.

## Qué es
Plataforma para que agentes de campo documenten la exhibición de productos en punto de venta. Cada visita captura GPS, fotos (panorámica del anaquel + acercamiento del producto) y metadatos de la tienda. Funciona sin señal y sincroniza después.

**No es una app para una sola empresa.** Es multi-cliente: cada empresa contratante tiene sus marcas, y esas marcas se venden en distintas cadenas de retail. Bikes Shot es el primer cliente, no el caso único. Ningún supuesto de negocio (Walmart, Bodega Aurrerá, motos, un solo país) va quemado en el código.

**Estado: prototipo.** Arranca con 2 empresas piloto. La prioridad es tener algo funcionando en campo, no una plataforma completa.

## Modelo del dominio
El esquema refleja esta jerarquía desde el día uno:

```
Cliente (empresa contratante)
  └── Marca (una empresa puede tener varias)
        └── Cadena / retailer (Walmart, Bodega Aurrerá, Sanborns, …)
              └── Tienda (sucursal, con su clave del retailer)
                    └── Visita (agente + fecha + evidencias)
```

- Un **agente** puede trabajar para más de un cliente y visitar varias cadenas en la misma ruta.
- Una **tienda** puede tener exhibiciones de varias marcas de distintos clientes: la visita se ancla a tienda + marca, no a tienda sola.
- Cada cadena tiene sus propias claves de sucursal y su vocabulario; no normalizar a la fuerza al lenguaje de una sola.
- Lo que se captura cambia por cliente (número de fotos, campos, checklist): el formato de captura es **configurable por cliente/marca**, no código distinto por cliente.

## Fases
**Fase 1 — prototipo (ahora).** Que 2 empresas capturen visitas reales en campo.
- Todas las tablas llevan `cliente_id` / `marca_id` / `cadena_id` desde el inicio, aunque la UI y la auth todavía no expongan el cambio de cliente. Meter esas columnas después es una migración dolorosa; ahora es gratis.
- Se acepta: onboarding manual de clientes, tiendas por CSV, configuración en archivos, un solo idioma, reportes básicos.
- No se acepta: lógica condicional con el nombre de un cliente adentro (`if cliente === 'bikesshot'`), campos con nombre de una sola cadena, ni supuestos de un solo tenant en el modelo de datos.

**Fase 2 — producto.** Aislamiento real por cliente (RLS en Supabase), alta self-service, roles y permisos, formatos configurables desde UI, reportes y tablero por cliente, facturación.

Al proponer algo, decir explícitamente si es de fase 1 o de fase 2. Ante la duda, entregar lo de fase 1 y dejar anotado el gancho para fase 2.

## Stack
- Astro + TypeScript (PWA)
- Supabase — Postgres, Auth y Storage (plan gratuito: vigilar egress y pausado por inactividad)
- Netlify para hosting y despliegue
- IndexedDB + Service Worker para cola offline y background sync
- En evaluación: Cloudflare R2 para servir imágenes; cron de keep-alive en GitHub Actions

## Reglas técnicas no negociables
- El agente puede estar sin señal toda la visita: **nada en el flujo de captura depende de la red**.
- **Nunca perder evidencia**: un registro sale de la cola solo cuando el servidor confirma que se guardó.
- **Idempotencia en el sync**: cada visita y cada foto llevan UUID generado en el cliente; reintentar no duplica.
- **Comprimir fotos en el cliente** antes de encolarlas — el costo real del producto es almacenamiento y egress de imágenes, y escala con el número de clientes.
- Los datos de un cliente nunca se mezclan ni se muestran a otro, aunque en fase 1 el aislamiento sea por consulta y no por RLS.
- Zona horaria de operación America/Mexico_City; timestamps guardados en UTC.
- Cualquier propuesta que aumente egress, storage o llamadas debe decir cuánto cuesta.

## Cómo trabajar en este repo
- **Español siempre**, con terminología de retail/logística (OC, CEDIS, CFDI, tarima, anaquel, exhibición, compradora).
- **Directo**: una recomendación con criterio y sus razones, no un menú de opciones. Preguntar solo cuando la decisión cambia el resultado de fondo.
- **Sesgo a entregar**: es prototipo. Antes que la arquitectura perfecta, lo que funcione en campo esta semana — siempre que no viole el modelo multi-cliente.
- **Cambios aditivos y no destructivos**: editar lo mínimo necesario, no reescribir lo que ya funciona.
- **Autonomía sobre dependencia**: soluciones que Mauricio pueda operar y mantener sin volver a pedirle algo a un modelo cada vez.
- **Leer antes de proponer**: revisar el código y el esquema actual; no asumir estructura.
- **Entregar archivos completos y funcionales**, no fragmentos que haya que ensamblar.

## Qué no hacer
- Quemar en el código el nombre de un cliente, una marca o una cadena.
- Refactors grandes no pedidos, ni sobre-ingeniería de fase 2 cuando lo que urge es el prototipo.
- Agregar dependencias pesadas sin justificar el peso en el bundle de la PWA.
- Cambiar el esquema de Supabase sin la migración correspondiente.
- Inventar datos de tiendas, agentes o resultados de campo.
