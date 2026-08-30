-- =============================================================================
-- 0001_init.sql — Esquema base de "La Misión - Agentes de Campo"
-- -----------------------------------------------------------------------------
-- Jerarquía del dominio (multi-cliente desde el día uno):
--   cliente -> marca
--   cliente -> cadena -> tienda
--   visita = agente + tienda + marca + evidencias
--
-- Reglas aplicadas (ver CLAUDE.md):
--  * Todas las tablas operativas llevan cliente_id.
--  * Nada quemado con nombre de cliente/marca/cadena: todo es dato.
--  * El formato de captura es configurable por marca (jsonb), no código por cliente.
--  * UUID de visita y evidencia los genera el cliente (idempotencia en el sync).
--  * timestamptz siempre (se guarda en UTC; la operación es America/Mexico_City).
--  * Integridad multi-tenant reforzada con llaves compuestas (id, cliente_id):
--    una visita NO puede referenciar marca/cadena/tienda de otro cliente.
--  * Aislamiento fase 1 = por consulta. La RLS real está en 9999_rls_fase2.sql.txt.
-- =============================================================================

create extension if not exists pgcrypto;

-- Función reutilizable para mantener updated_at ------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- CLIENTES (empresa contratante)
-- =============================================================================
create table public.clientes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_clientes_updated_at
  before update on public.clientes
  for each row execute function public.set_updated_at();

-- =============================================================================
-- MARCAS (una empresa puede tener varias)
-- =============================================================================
create table public.marcas (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  nombre         text not null,
  -- Formato de captura configurable por marca: cuántas fotos, campos y checklist.
  -- Es DATO, no código. Cada marca puede sobreescribir el default.
  config_captura jsonb not null default
    '{"fotos":[{"tipo":"panoramica","etiqueta":"Panorámica del anaquel","obligatoria":true},{"tipo":"acercamiento","etiqueta":"Acercamiento del producto","obligatoria":true}],"campos":[],"checklist":[]}'::jsonb,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (cliente_id, nombre),
  -- Necesario para las llaves compuestas de integridad multi-tenant.
  unique (id, cliente_id)
);

create index idx_marcas_cliente on public.marcas (cliente_id);

create trigger trg_marcas_updated_at
  before update on public.marcas
  for each row execute function public.set_updated_at();

-- =============================================================================
-- CADENAS / retailers (Walmart, Bodega Aurrerá, Sanborns, …)
-- Catálogo por cliente: cada cliente da de alta las cadenas con su vocabulario.
-- =============================================================================
create table public.cadenas (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cliente_id, nombre),
  unique (id, cliente_id)
);

create index idx_cadenas_cliente on public.cadenas (cliente_id);

create trigger trg_cadenas_updated_at
  before update on public.cadenas
  for each row execute function public.set_updated_at();

-- =============================================================================
-- TIENDAS (sucursal de una cadena, con su clave del retailer)
-- =============================================================================
create table public.tiendas (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  cadena_id      uuid not null,
  clave_sucursal text not null,          -- clave de la sucursal según el retailer
  nombre         text,
  direccion      text,
  municipio      text,
  estado         text,                   -- entidad federativa
  latitud        double precision,
  longitud       double precision,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- La tienda pertenece a una cadena del MISMO cliente (integridad multi-tenant).
  foreign key (cadena_id, cliente_id)
    references public.cadenas (id, cliente_id) on delete restrict,
  -- Cada cadena tiene sus propias claves de sucursal: única dentro de la cadena.
  unique (cadena_id, clave_sucursal),
  unique (id, cliente_id)
);

create index idx_tiendas_cliente on public.tiendas (cliente_id);
create index idx_tiendas_cadena  on public.tiendas (cadena_id);

create trigger trg_tiendas_updated_at
  before update on public.tiendas
  for each row execute function public.set_updated_at();

-- =============================================================================
-- AGENTES (pueden trabajar para más de un cliente)
-- user_id enlaza con Supabase Auth cuando exista; en fase 1 puede ir nulo.
-- =============================================================================
create table public.agentes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references auth.users(id) on delete set null,
  nombre     text not null,
  email      text,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_agentes_updated_at
  before update on public.agentes
  for each row execute function public.set_updated_at();

-- Relación agente <-> cliente (un agente atiende a varios clientes) -----------
create table public.agente_cliente (
  agente_id  uuid not null references public.agentes(id)  on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agente_id, cliente_id)
);

create index idx_agente_cliente_cliente on public.agente_cliente (cliente_id);

-- =============================================================================
-- VISITAS (se ancla a tienda + marca, no a tienda sola)
-- El id lo genera el cliente para idempotencia: en el sync se usa
-- `insert ... on conflict (id) do nothing`, así reintentar no duplica.
-- =============================================================================
create table public.visitas (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete restrict,
  marca_id     uuid not null,
  cadena_id    uuid not null,
  tienda_id    uuid not null,
  agente_id    uuid not null references public.agentes(id) on delete restrict,
  capturada_en timestamptz not null,               -- hora real de captura en el dispositivo (offline)
  latitud      double precision,
  longitud     double precision,
  datos        jsonb not null default '{}'::jsonb,  -- respuestas de campos/checklist configurables
  notas        text,
  created_at   timestamptz not null default now(),  -- cuando el servidor la recibió (sync)
  updated_at   timestamptz not null default now(),
  -- Todo lo referenciado debe ser del MISMO cliente (integridad multi-tenant):
  foreign key (marca_id, cliente_id)
    references public.marcas  (id, cliente_id) on delete restrict,
  foreign key (cadena_id, cliente_id)
    references public.cadenas (id, cliente_id) on delete restrict,
  foreign key (tienda_id, cliente_id)
    references public.tiendas (id, cliente_id) on delete restrict,
  unique (id, cliente_id)
);

create index idx_visitas_cliente     on public.visitas (cliente_id);
create index idx_visitas_tienda      on public.visitas (tienda_id);
create index idx_visitas_marca       on public.visitas (marca_id);
create index idx_visitas_agente      on public.visitas (agente_id);
create index idx_visitas_capturada   on public.visitas (capturada_en);

create trigger trg_visitas_updated_at
  before update on public.visitas
  for each row execute function public.set_updated_at();

-- =============================================================================
-- EVIDENCIAS (fotos de la visita). id generado en cliente (idempotencia).
-- tipo referencia un "tipo" definido en config_captura de la marca: NO hardcodeado
-- a 2 fotos; el número y los tipos los define la configuración.
-- =============================================================================
create table public.evidencias (
  id           uuid primary key default gen_random_uuid(),
  visita_id    uuid not null,
  cliente_id   uuid not null,
  tipo         text not null,          -- p.ej. "panoramica" | "acercamiento" | los que defina la marca
  storage_path text not null,          -- ruta dentro del bucket 'evidencias'
  orden        smallint,
  ancho        int,
  alto         int,
  bytes        int,
  created_at   timestamptz not null default now(),
  -- La evidencia pertenece a una visita del MISMO cliente (integridad multi-tenant):
  foreign key (visita_id, cliente_id)
    references public.visitas (id, cliente_id) on delete cascade
);

create index idx_evidencias_visita  on public.evidencias (visita_id);
create index idx_evidencias_cliente on public.evidencias (cliente_id);
