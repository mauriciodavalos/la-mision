-- =============================================================================
-- 0006_asignaciones.sql — Qué captura cada agente, y rol de administrador
-- -----------------------------------------------------------------------------
-- El problema: hasta ahora, un agente ligado a un cliente veía TODO lo de ese
-- cliente — todas sus marcas y todas sus tiendas. Eso no refleja la operación:
--   * Lalo visita Bodega Aurrerá para Bikes Shot.
--   * Carmen visita Sanborns para Ondina y Anframa (dos marcas del mismo cliente).
--   * Mau administra: captura y consulta en todo, de todos los clientes.
--
-- Sin esto, un agente con dos marcas asignadas puede capturar con la marca
-- equivocada sin darse cuenta, y la evidencia queda mal atribuida hasta que
-- alguien lo note en el reporte — o nunca.
--
-- Granularidad: MARCA + CADENA COMPLETA, no tienda por tienda. Así, las
-- sucursales nuevas que se carguen por CSV aparecen solas para quien ya tiene esa
-- cadena asignada, sin tener que reasignar nada a mano (que es justo el paso que
-- se olvida y deja a un agente sin ver sus tiendas).
--
-- FASE 1: el filtro es por consulta, igual que el resto del aislamiento. La RLS
-- de fase 2 (9999_rls_fase2.sql.txt) lo endurece a nivel base.
-- =============================================================================

-- ---- rol de administrador ---------------------------------------------------
-- Un admin se salta los filtros: ve y captura en cualquier marca y cualquier
-- punto de venta, de cualquier cliente, sin necesitar filas de asignación ni de
-- membresía. Es una bandera y no una tabla de roles porque en fase 1 solo hay dos
-- niveles; cuando haya más (supervisor, lector, admin del lado del cliente), esto
-- se convierte en un rol con su tabla.
alter table public.agentes
  add column if not exists es_admin boolean not null default false;

comment on column public.agentes.es_admin is
  'true = se salta las asignaciones y la membresía: ve y captura en todo. Fase 1.';

-- ---- asignaciones -----------------------------------------------------------
-- `agente_cliente` (0001) sigue siendo la MEMBRESÍA: en qué clientes puede
-- identificarse el agente. Esta tabla es el ALCANCE: qué marca, en qué cadena.
create table if not exists public.agente_asignacion (
  id         uuid primary key default gen_random_uuid(),
  agente_id  uuid not null references public.agentes(id)  on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  marca_id   uuid not null,
  cadena_id  uuid not null,
  created_at timestamptz not null default now(),
  -- Integridad multi-tenant, mismo patrón que `visitas` en 0001_init.sql: la
  -- marca y la cadena tienen que ser del MISMO cliente de la asignación. Con
  -- estas llaves compuestas es imposible asignar "marca de un cliente en cadena
  -- de otro", aunque alguien lo intente a mano.
  foreign key (marca_id, cliente_id)
    references public.marcas  (id, cliente_id) on delete cascade,
  foreign key (cadena_id, cliente_id)
    references public.cadenas (id, cliente_id) on delete cascade,
  unique (agente_id, marca_id, cadena_id)
);

create index if not exists idx_asignacion_agente
  on public.agente_asignacion (agente_id, cliente_id);
create index if not exists idx_asignacion_cliente
  on public.agente_asignacion (cliente_id);

comment on table public.agente_asignacion is
  'Qué marca y en qué cadena captura cada agente. Un agente sin filas aquí no ve marcas (salvo que sea admin).';
