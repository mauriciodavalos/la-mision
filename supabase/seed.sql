-- =============================================================================
-- seed.sql — Datos semilla (plantilla)
-- -----------------------------------------------------------------------------
-- NO se inventan datos reales de clientes, tiendas ni agentes (ver CLAUDE.md).
-- Este archivo muestra la FORMA de los inserts para el onboarding manual de
-- fase 1. Todo está comentado: correrlo tal cual no inserta nada.
--
-- Para dar de alta un cliente piloto real, descomenta y reemplaza los valores.
-- El orden respeta las llaves foráneas: cliente -> marca/cadena -> tienda ->
-- agente -> membresía. Las visitas y evidencias las genera la app en campo.
-- =============================================================================

-- 1) Cliente (empresa contratante)
-- with c as (
--   insert into public.clientes (nombre) values ('NOMBRE DEL CLIENTE')
--   returning id
-- )
-- 2) Marca(s) del cliente
-- insert into public.marcas (cliente_id, nombre)
--   select id, 'NOMBRE DE LA MARCA' from c;

-- 3) Cadena(s) donde se vende
-- insert into public.cadenas (cliente_id, nombre)
--   values ('<CLIENTE_ID>', 'NOMBRE DE LA CADENA');

-- 4) Tienda(s) — normalmente por carga CSV. clave_sucursal es la del retailer.
-- insert into public.tiendas (cliente_id, cadena_id, clave_sucursal, nombre, municipio, estado, latitud, longitud)
--   values ('<CLIENTE_ID>', '<CADENA_ID>', 'CLAVE-RETAILER', 'NOMBRE SUCURSAL', 'MUNICIPIO', 'ENTIDAD', 19.4326, -99.1332);

-- 5) Agente y su membresía al cliente
-- with a as (
--   insert into public.agentes (nombre, email) values ('NOMBRE AGENTE', 'correo@ejemplo.mx')
--   returning id
-- )
-- insert into public.agente_cliente (agente_id, cliente_id)
--   select a.id, '<CLIENTE_ID>' from a;
