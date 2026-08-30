-- =============================================================================
-- alta_cliente.sql — Onboarding manual de un cliente (FASE 1)
-- -----------------------------------------------------------------------------
-- Da de alta, en una sola corrida: cliente -> marca -> cadena -> agentes ->
-- membresía agente_cliente -> PIN de cada agente.
--
-- Las TIENDAS no van aquí: se cargan por CSV desde /admin/tiendas, que es lo que
-- va a crecer con el tiempo (ver src/pages/admin/tiendas.astro).
--
-- CÓMO USARLO
--   1. Llena el bloque "LLENA ESTO" de abajo con los datos reales.
--   2. Córrelo:  npx supabase db query --linked -f supabase/alta_cliente.sql
--   3. Verifica que el PIN quedó hasheado (nunca en claro):
--        select nombre, pin_hash is not null as tiene_pin from public.agentes;
--   4. Este archivo NO se versiona con datos reales adentro: déjalo con los
--      valores de ejemplo antes de hacer commit. Los nombres de clientes, marcas
--      y cadenas viven en la base, no en el repo.
--
-- Es SEGURO correrlo dos veces: si el cliente/marca/cadena/agente ya existe, lo
-- reutiliza en vez de duplicarlo. Volver a correrlo SÍ rota los PIN (genera salt
-- nuevo), así que sirve también para cambiar un PIN olvidado.
-- =============================================================================

do $$
declare
  -- ======================== LLENA ESTO =====================================
  v_cliente_nombre text := 'NOMBRE DE LA EMPRESA CONTRATANTE';
  v_marca_nombre   text := 'NOMBRE DE LA MARCA';
  v_cadena_nombre  text := 'NOMBRE DE LA CADENA';

  -- Un renglón por agente: nombre | correo (puede ir '') | PIN de 4 dígitos.
  v_agentes text[] := array[
    ['NOMBRE DEL AGENTE 1', 'correo1@ejemplo.mx', '1234'],
    ['NOMBRE DEL AGENTE 2', 'correo2@ejemplo.mx', '5678']
  ];

  -- Formato de captura de ESTA marca. Es DATO: cambiarlo después es un update a
  -- marcas.config_captura, no código. Se puede agregar "campos" y "checklist".
  v_config_captura jsonb := '{
    "fotos": [
      {"tipo":"panoramica","etiqueta":"Panorámica del anaquel","obligatoria":true,"ancha":true,
       "ayuda":"Todo el mueble o góndola, con el pasillo visible."},
      {"tipo":"acercamiento","etiqueta":"Acercamiento del producto","obligatoria":true,
       "ayuda":"Producto en anaquel, con etiqueta de precio legible."}
    ],
    "campos": [],
    "checklist": []
  }'::jsonb;
  -- =========================================================================

  v_cliente uuid;
  v_marca   uuid;
  v_cadena  uuid;
  v_agente  uuid;
  v_nombre  text;
  v_email   text;
  v_pin     text;
  i         int;
begin
  -- Freno anti-descuido: no dejar que se creen los valores de ejemplo.
  if v_cliente_nombre like 'NOMBRE DE %' or v_marca_nombre like 'NOMBRE DE %' then
    raise exception 'Llena el bloque "LLENA ESTO" antes de correr este script.';
  end if;

  -- 1) Cliente ---------------------------------------------------------------
  select id into v_cliente from public.clientes where nombre = v_cliente_nombre;
  if v_cliente is null then
    insert into public.clientes (nombre) values (v_cliente_nombre) returning id into v_cliente;
    raise notice 'Cliente creado: % (%)', v_cliente_nombre, v_cliente;
  else
    raise notice 'Cliente ya existía: % (%)', v_cliente_nombre, v_cliente;
  end if;

  -- 2) Marca -----------------------------------------------------------------
  insert into public.marcas (cliente_id, nombre, config_captura)
  values (v_cliente, v_marca_nombre, v_config_captura)
  on conflict (cliente_id, nombre)
    do update set config_captura = excluded.config_captura, activo = true
  returning id into v_marca;
  raise notice 'Marca lista: % (%)', v_marca_nombre, v_marca;

  -- 3) Cadena ----------------------------------------------------------------
  insert into public.cadenas (cliente_id, nombre)
  values (v_cliente, v_cadena_nombre)
  on conflict (cliente_id, nombre) do update set activo = true
  returning id into v_cadena;
  raise notice 'Cadena lista: % (%)', v_cadena_nombre, v_cadena;

  -- 4) Agentes + membresía + PIN ---------------------------------------------
  for i in 1 .. array_length(v_agentes, 1) loop
    v_nombre := v_agentes[i][1];
    v_email  := nullif(v_agentes[i][2], '');
    v_pin    := v_agentes[i][3];

    -- Se identifica por correo si lo hay; si no, por nombre.
    if v_email is not null then
      select id into v_agente from public.agentes where email = v_email;
    else
      select id into v_agente from public.agentes where nombre = v_nombre;
    end if;

    if v_agente is null then
      insert into public.agentes (nombre, email) values (v_nombre, v_email)
      returning id into v_agente;
      raise notice 'Agente creado: %', v_nombre;
    else
      update public.agentes set nombre = v_nombre, activo = true where id = v_agente;
      raise notice 'Agente ya existía: %', v_nombre;
    end if;

    -- Un agente puede atender a varios clientes: la membresía es N:N.
    insert into public.agente_cliente (agente_id, cliente_id)
    values (v_agente, v_cliente)
    on conflict do nothing;

    -- PIN: guarda solo salt + sha256(pin||salt). Ver 0004_pin_agente.sql.
    perform public.set_pin_agente(v_agente, v_pin);
    v_agente := null;
  end loop;

  raise notice '--- Listo. Siguiente paso: cargar las tiendas por CSV en /admin/tiendas ---';
end $$;

-- =============================================================================
-- Después de verificar en campo con datos reales, borrar el tenant de prueba:
--   delete from public.clientes where nombre = '[DEMO] Cliente de prueba';
-- (el on delete cascade limpia sus marcas, cadenas, tiendas, visitas y evidencias)
--
-- Para rotar el PIN de un agente sin volver a correr todo esto:
--   select public.set_pin_agente(
--     (select id from public.agentes where nombre = 'NOMBRE DEL AGENTE'), '4321');
-- =============================================================================
