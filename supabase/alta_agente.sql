-- =============================================================================
-- alta_agente.sql — Da de alta un agente, lo liga a un cliente y le asigna qué
-- captura (FASE 1)
-- -----------------------------------------------------------------------------
--   1. Llena el bloque "LLENA ESTO".
--   2. npx supabase db query --linked -f supabase/alta_agente.sql
--   3. Deja el archivo con los valores de ejemplo antes de hacer commit: los
--      nombres y PIN reales viven en la base, no en el repo.
--
-- Es seguro correrlo dos veces: si el agente ya existe lo reutiliza, le rota el
-- PIN y vuelve a poner sus asignaciones. Sirve también para cambiar un PIN
-- olvidado o para corregir a quién atiende.
--
-- ASIGNACIONES: cada renglón es "marca | cadena". El agente verá esa marca y solo
-- las tiendas de esa cadena. Las sucursales nuevas que cargues por CSV a esa
-- cadena le aparecen solas, sin reasignar nada.
--
-- ADMIN: con v_es_admin = true se salta TODO lo anterior — ve y captura en
-- cualquier marca y cualquier punto de venta, de cualquier cliente. En ese caso
-- las asignaciones sobran y se pueden dejar vacías.
-- =============================================================================

do $$
declare
  -- ======================== LLENA ESTO =====================================
  v_cliente_nombre text := 'NOMBRE DE LA EMPRESA CONTRATANTE';
  v_agente_nombre  text := 'NOMBRE DEL AGENTE';
  v_agente_email   text := '';        -- puede ir vacío
  v_pin            text := '0000';    -- 4 dígitos
  v_es_admin       boolean := false;  -- true = ve y captura en todo

  -- Qué captura: un renglón por par marca | cadena. Vacío si es admin.
  v_asignaciones text[] := array[
    ['NOMBRE DE LA MARCA', 'NOMBRE DE LA CADENA']
  ];
  -- =========================================================================

  v_cliente uuid;
  v_agente  uuid;
  v_marca   uuid;
  v_cadena  uuid;
  v_email   text;
  i         int;
begin
  v_email := nullif(v_agente_email, '');

  select id into v_cliente from public.clientes where nombre = v_cliente_nombre;
  if v_cliente is null then
    raise exception 'No existe el cliente "%". Córrelo primero con alta_cliente.sql.', v_cliente_nombre;
  end if;

  -- Se identifica por correo si lo hay; si no, por nombre.
  if v_email is not null then
    select id into v_agente from public.agentes where email = v_email;
  else
    select id into v_agente from public.agentes where nombre = v_agente_nombre;
  end if;

  if v_agente is null then
    insert into public.agentes (nombre, email, es_admin)
    values (v_agente_nombre, v_email, v_es_admin)
    returning id into v_agente;
    raise notice 'Agente creado: %', v_agente_nombre;
  else
    update public.agentes
       set nombre = v_agente_nombre, activo = true, es_admin = v_es_admin
     where id = v_agente;
    raise notice 'Agente ya existía, se actualiza: %', v_agente_nombre;
  end if;

  -- Un agente puede atender a varios clientes: la membresía es N:N.
  insert into public.agente_cliente (agente_id, cliente_id)
  values (v_agente, v_cliente)
  on conflict do nothing;

  perform public.set_pin_agente(v_agente, v_pin);

  -- Asignaciones de ESTE cliente. Se reemplazan por completo, para que corregir
  -- una ruta sea volver a correr el script con la lista correcta.
  delete from public.agente_asignacion
   where agente_id = v_agente and cliente_id = v_cliente;

  if not v_es_admin then
    for i in 1 .. coalesce(array_length(v_asignaciones, 1), 0) loop
      select id into v_marca  from public.marcas
       where cliente_id = v_cliente and nombre = v_asignaciones[i][1];
      if v_marca is null then
        raise exception 'El cliente "%" no tiene la marca "%".', v_cliente_nombre, v_asignaciones[i][1];
      end if;

      select id into v_cadena from public.cadenas
       where cliente_id = v_cliente and nombre = v_asignaciones[i][2];
      if v_cadena is null then
        raise exception 'El cliente "%" no tiene la cadena "%".', v_cliente_nombre, v_asignaciones[i][2];
      end if;

      insert into public.agente_asignacion (agente_id, cliente_id, marca_id, cadena_id)
      values (v_agente, v_cliente, v_marca, v_cadena)
      on conflict do nothing;

      raise notice 'Asignado: % -> % en %', v_agente_nombre, v_asignaciones[i][1], v_asignaciones[i][2];
      v_marca := null; v_cadena := null;
    end loop;
  else
    raise notice '% es ADMIN: ve y captura en todo, sin asignaciones.', v_agente_nombre;
  end if;
end $$;

-- Quién captura qué, en cada cliente:
select c.nombre as cliente,
       a.nombre as agente,
       case when a.es_admin then 'ADMIN (todo)'
            else coalesce(string_agg(distinct m.nombre || ' @ ' || ca.nombre, ' | '), '(sin asignaciones)')
       end as captura,
       (a.pin_hash is not null) as tiene_pin
from public.agente_cliente ac
join public.clientes c on c.id = ac.cliente_id
join public.agentes  a on a.id = ac.agente_id
left join public.agente_asignacion asg
       on asg.agente_id = a.id and asg.cliente_id = c.id
left join public.marcas  m  on m.id  = asg.marca_id
left join public.cadenas ca on ca.id = asg.cadena_id
group by c.nombre, a.nombre, a.es_admin, a.pin_hash
order by c.nombre, a.nombre;
