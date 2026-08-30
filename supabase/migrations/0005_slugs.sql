-- =============================================================================
-- 0005_slugs.sql — Slugs estables para cliente y cadena
-- -----------------------------------------------------------------------------
-- Para qué:
--  1. Rutas LEGIBLES en el Storage. Antes: {cliente_id}/{visita_id}/{foto_id}.webp
--     — imposible de entender viendo el bucket. Ahora:
--       bikes-shot/bodega-aurrera/3784-ba-1-de-mayo/2026-08-30_1639_panoramica_889a6a79.webp
--  2. URL por empresa (bikesshot.dominio o /c/bikes-shot): el slug resuelve a
--     cliente_id sin exponer UUIDs ni depender del orden de un listado.
--
-- Por qué un slug y no el nombre tal cual:
--  * Sin acentos ni espacios: los acentos en llaves de Storage dan problemas al
--    armar URLs.
--  * ESTABLE: el nombre para mostrar puede cambiar ("Bikes Shot" -> "Bikes Shot
--    México") sin que se muevan las carpetas ya escritas. El slug se asigna una
--    vez y no se toca. Si algún día hay que cambiarlo, hay que mover el Storage.
--
-- OJO fase 2: el gancho de RLS (9999_rls_fase2.sql.txt) asumía que el primer
-- segmento de la ruta era el cliente_id. Pasa a ser el slug del cliente. Sigue
-- siendo igual de seguro porque el slug es único e inmutable en la práctica.
-- =============================================================================

-- unaccent: para generar el slug quitando acentos (Aurrerá -> aurrera).
create extension if not exists unaccent;

create or replace function public.slugify(p text)
returns text
language sql
stable
strict
set search_path = public, extensions
as $$
  select trim(both '-' from
    regexp_replace(lower(unaccent(p)), '[^a-z0-9]+', '-', 'g')
  );
$$;

comment on function public.slugify(text) is
  'Convierte un nombre en slug: sin acentos, minúsculas, solo a-z0-9 y guiones.';

-- ---- clientes ---------------------------------------------------------------
alter table public.clientes add column if not exists slug text;

update public.clientes set slug = public.slugify(nombre) where slug is null;

alter table public.clientes alter column slug set not null;

-- Único global: el slug del cliente es el primer segmento de la ruta de Storage
-- y (a futuro) su subdominio, así que no puede repetirse entre clientes.
create unique index if not exists idx_clientes_slug on public.clientes (slug);

-- ---- cadenas ----------------------------------------------------------------
alter table public.cadenas add column if not exists slug text;

update public.cadenas set slug = public.slugify(nombre) where slug is null;

alter table public.cadenas alter column slug set not null;

-- Único DENTRO del cliente: cada cliente da de alta sus cadenas con su propio
-- vocabulario, y dos clientes distintos sí pueden tener "bodega-aurrera".
create unique index if not exists idx_cadenas_cliente_slug
  on public.cadenas (cliente_id, slug);

comment on column public.clientes.slug is
  'Identificador estable para rutas de Storage y URL por empresa. No cambiar: mover el Storage.';
comment on column public.cadenas.slug is
  'Identificador estable de la cadena dentro del cliente. Segundo segmento de la ruta de Storage.';
