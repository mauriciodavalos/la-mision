-- =============================================================================
-- limpieza_demo.sql — Borra el tenant de prueba [DEMO] y sus datos.
-- -----------------------------------------------------------------------------
-- Se corre UNA VEZ, cuando ya se verificó el flujo con un cliente real y el
-- tenant de prueba (seed_demo.sql) dejó de hacer falta.
--
--   npx supabase db query --linked -f supabase/limpieza_demo.sql
--
-- OJO — el orden importa: `visitas` referencia a `clientes` con ON DELETE RESTRICT,
-- así que borrar el cliente directamente FALLA mientras tenga visitas. Hay que
-- vaciar las visitas primero. `evidencias` cae sola por cascade desde visitas, y
-- marca, cadena y tiendas caen por cascade desde clientes.
--
-- OJO 2 — esto NO borra las fotos del Storage. Tablas y Storage son almacenes
-- distintos: borrar filas deja los archivos huérfanos ocupando cuota. Los archivos
-- del tenant se borran aparte, en la carpeta {cliente_id}/ del bucket `evidencias`.
-- =============================================================================

do $$
declare
  v_demo    uuid;
  v_visitas int;
  v_evid    int;
begin
  select id into v_demo from public.clientes where nombre = '[DEMO] Cliente de prueba';
  if v_demo is null then
    raise notice 'El tenant [DEMO] ya no existe. Nada que hacer.';
    return;
  end if;

  select count(*) into v_evid    from public.evidencias where cliente_id = v_demo;
  select count(*) into v_visitas from public.visitas    where cliente_id = v_demo;

  delete from public.visitas where cliente_id = v_demo;

  -- Agentes que SOLO pertenecían al DEMO. No se toca a un agente que además
  -- atienda a otro cliente: un agente puede trabajar para varios.
  delete from public.agentes a
   where exists (select 1 from public.agente_cliente ac
                  where ac.agente_id = a.id and ac.cliente_id = v_demo)
     and not exists (select 1 from public.agente_cliente ac2
                      where ac2.agente_id = a.id and ac2.cliente_id <> v_demo);

  delete from public.clientes where id = v_demo;

  raise notice 'Borrado [DEMO]: % visitas y % evidencias, mas su marca, cadena y tiendas.',
    v_visitas, v_evid;
end $$;

-- Cómo quedó la base:
select c.nombre as cliente,
       (select count(*) from public.tiendas    t where t.cliente_id = c.id) as tiendas,
       (select count(*) from public.visitas    v where v.cliente_id = c.id) as visitas,
       (select count(*) from public.evidencias e where e.cliente_id = c.id) as evidencias
from public.clientes c order by c.nombre;
