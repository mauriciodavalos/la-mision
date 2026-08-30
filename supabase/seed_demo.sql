-- =============================================================================
-- seed_demo.sql — Datos DEMO para probar el flujo de captura punta a punta.
-- -----------------------------------------------------------------------------
-- NO son datos reales de campo: es un tenant de prueba, claramente etiquetado y
-- 100% borrable. Sirve para ver el formulario funcionando antes de hacer el
-- onboarding real. Para borrarlo todo: delete from public.clientes where nombre = '[DEMO] Cliente de prueba';
-- (el on delete cascade limpia marcas, cadenas, tiendas, agente y visitas).
--
-- Aplica una sola vez en el SQL Editor, o con: supabase db execute --file supabase/seed_demo.sql
-- =============================================================================

do $$
declare
  v_cliente uuid;
  v_marca   uuid;
  v_cadena  uuid;
  v_agente  uuid;
begin
  insert into public.clientes (nombre) values ('[DEMO] Cliente de prueba')
    returning id into v_cliente;

  insert into public.marcas (cliente_id, nombre, config_captura)
    values (
      v_cliente,
      '[DEMO] Marca de prueba',
      '{"fotos":[
          {"tipo":"panoramica","etiqueta":"Panorámica","obligatoria":true,"ancha":true,"ayuda":"Todo el mueble o góndola, con el pasillo visible."},
          {"tipo":"acercamiento","etiqueta":"Acercamiento","obligatoria":true,"ayuda":"Producto en anaquel, con etiqueta de precio legible."}
        ],
        "campos":[],
        "checklist":[]}'::jsonb
    )
    returning id into v_marca;

  insert into public.cadenas (cliente_id, nombre) values (v_cliente, '[DEMO] Cadena de prueba')
    returning id into v_cadena;

  insert into public.tiendas (cliente_id, cadena_id, clave_sucursal, nombre, municipio, estado, latitud, longitud) values
    (v_cliente, v_cadena, 'DEMO-001', '[DEMO] Sucursal Centro', 'Cuauhtémoc', 'CDMX', 19.4326, -99.1332),
    (v_cliente, v_cadena, 'DEMO-002', '[DEMO] Sucursal Norte',  'Monterrey',  'Nuevo León', 25.6866, -100.3161);

  insert into public.agentes (nombre, email) values ('[DEMO] Agente de prueba', 'demo@ejemplo.mx')
    returning id into v_agente;

  insert into public.agente_cliente (agente_id, cliente_id) values (v_agente, v_cliente);
end $$;
