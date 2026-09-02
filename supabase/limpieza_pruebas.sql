-- =============================================================================
-- limpieza_pruebas.sql — Borra las visitas de PRUEBA capturadas durante el
-- desarrollo (31-ago a 02-sep 2026), dejando solo las visitas reales de campo.
-- -----------------------------------------------------------------------------
-- Se corre UNA VEZ, con la lista de UUID congelada abajo. NO borra por fecha ni
-- por texto de la nota: borra por id explícito, revisado uno por uno con
-- Mauricio. Así no se lleva por delante una visita real que caiga en el mismo
-- rango de fechas.
--
--   npx supabase db query --linked -f supabase/limpieza_pruebas.sql
--
-- ORDEN — corre PRIMERO el borrado de fotos (limpieza_pruebas_fotos.sh) y
-- después este archivo. Tablas y Storage son almacenes distintos: si borras las
-- filas primero, pierdes el rastro de qué archivos quedaron huérfanos.
--
-- Es idempotente: correrlo dos veces borra 0 la segunda vez.
--
-- SE CONSERVAN (4 visitas reales de campo):
--   ce556867  31-ago 14:30  Lalo    Bikes Shot / BA FLORES MAGON
--   b9285d7b  02-sep 10:53  Carmen  Anframa    / HOSPITALES
--   699f4ba7  02-sep 11:09  Romina  Ondina     / PARQUE LINDAVISTA
--   d8f421dc  02-sep 11:11  Romina  Anframa    / PARQUE LINDAVISTA
--
-- NO se toca ningún agente: "Mau" se queda dado de alta (sin visitas) para
-- seguir probando en campo sin volver a darlo de alta.
-- =============================================================================

do $$
declare
  v_pruebas uuid[] := array[
    'e98caac7-0ff1-4abb-b476-bfaa104496ac',  -- 08-31 16:40 Carmen  "Prueba"
    '9cc6aed0-f02d-48bb-b42b-5afa7268cfed',  -- 08-31 16:41 Carmen  "Prueba"
    '754e8dff-e214-4f35-b332-c1239af4073c',  -- 08-31 16:49 Carmen  "Prueba"
    'fdbef7e0-d66f-4c91-afd0-a991d7b30f7b',  -- 08-31 16:53 Carmen  "Prueba no dice ubicacion"
    '6b06af77-3efc-4256-955e-c6553937d2f7',  -- 08-31 17:29 Romina  sin nota, tanda de pruebas
    '1e9a6046-223d-4931-9a8c-a12526c29a71',  -- 08-31 17:29 Carmen  "Prueba sin ubicación"
    '7210005c-fa3c-4384-bf7c-91bd5173d1b7',  -- 08-31 17:31 Carmen  sin nota, tanda de pruebas
    '2e894ebf-6a18-4b3d-8940-e87f03471dd6',  -- 08-31 17:32 Carmen  "Prueba"
    '92d1c2cb-8fe9-4bd4-a51c-3724c2ab4764',  -- 09-01 19:43 Mau     sin nota, tanda v4
    '57c59a69-c04f-4080-a477-6855c09d2114',  -- 09-01 20:06 Romina  "Prueba v4"
    '94ea9553-ca2b-436a-b642-89cd4f42f265',  -- 09-01 20:12 Mau     "Prueba v4 2"
    '4abb128b-f7f4-4d81-8451-af1e57c7cc78',  -- 09-01 20:14 Mau     "Prueba v4 estética popup"
    '14fc8cca-3005-406d-9a54-655807daeb48',  -- 09-01 20:19 Mau     "Prueba v4 sin señal"
    '99fdf32c-e921-4db0-8a53-ae58891f1976',  -- 09-01 20:41 Mau     "Prueba v4 camara interna"
    'a326faeb-a01e-426c-b1ad-3c6ad8cd0aa4'   -- 09-02 08:55 Romina  "..."
  ]::uuid[];
  v_visitas int;
  v_evid    int;
begin
  select count(*) into v_visitas from public.visitas    where id        = any(v_pruebas);
  select count(*) into v_evid    from public.evidencias where visita_id = any(v_pruebas);

  if v_visitas = 0 then
    raise notice 'No queda ninguna visita de prueba de la lista. Nada que hacer.';
    return;
  end if;

  -- Las evidencias caen solas: on delete cascade desde visitas.
  delete from public.visitas where id = any(v_pruebas);

  raise notice 'Borradas % visitas de prueba y sus % evidencias.', v_visitas, v_evid;
end $$;

-- Cómo quedó la base:
select c.nombre as cliente,
       (select count(*) from public.tiendas    t where t.cliente_id = c.id) as tiendas,
       (select count(*) from public.visitas    v where v.cliente_id = c.id) as visitas,
       (select count(*) from public.evidencias e where e.cliente_id = c.id) as evidencias
from public.clientes c order by c.nombre;

-- Las visitas que quedan, una por línea:
select to_char(v.capturada_en at time zone 'America/Mexico_City','MM-DD HH24:MI') as capturada_mx,
       c.nombre as cliente, a.nombre as agente, m.nombre as marca, t.nombre as tienda,
       (select count(*) from public.evidencias e where e.visita_id = v.id) as fotos
from public.visitas v
join public.clientes c on c.id = v.cliente_id
join public.agentes  a on a.id = v.agente_id
join public.marcas   m on m.id = v.marca_id
join public.tiendas  t on t.id = v.tienda_id
order by v.capturada_en;
