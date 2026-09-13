-- =============================================================================
-- 0008_cp_tienda.sql — Código postal de la sucursal
-- -----------------------------------------------------------------------------
-- El catálogo real de Sanborns (13 sep 2026) trae CP para las 141 sucursales y
-- no había dónde guardarlo: la columna no existía, así que el importador lo
-- descartaba en silencio.
--
-- TEXT Y NO INTEGER, a propósito. Los códigos postales de México empiezan con
-- cero en buena parte del centro del país —el Centro Histórico de CDMX es
-- 06500— y guardarlos como número los convierte en 6500. Eso no se nota al
-- cargarlos: se nota meses después, cuando un CP no cruza contra ningún padrón
-- y nadie entiende por qué. Además un CP no es una cantidad: no se suma ni se
-- promedia, así que no gana nada siendo numérico.
--
-- Nulo permitido: las 123 sucursales de Bodega Aurrerá todavía no lo tienen, y
-- el catálogo de un cliente nuevo puede llegar sin él.
--
-- Sin índice: hoy no se busca por CP. Si algún día se agrupa por zona postal,
-- se agrega entonces.
--
-- COSTO: unos bytes por sucursal. Cero llamadas nuevas.
-- =============================================================================

alter table public.tiendas
  add column if not exists cp text;

comment on column public.tiendas.cp is
  'Código postal de la sucursal. TEXT para conservar el cero inicial (06500). '
  'Nulo mientras el catálogo del cliente no lo traiga.';
