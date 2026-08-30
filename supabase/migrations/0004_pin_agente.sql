-- =============================================================================
-- 0004_pin_agente.sql — Identidad del agente en FASE 1 (sin auth todavía)
-- -----------------------------------------------------------------------------
-- Problema que resuelve: hasta ahora el agente se elegía de un dropdown sin
-- verificar nada, así que cualquiera con la URL podía capturar a nombre de otro.
-- Con visitas reales en campo, un registro mal atribuido no se puede disputar.
--
-- Solución de fase 1: un PIN de 4 dígitos por agente. Se guarda SOLO el hash
-- (sha256 del pin + un salt aleatorio por agente); el PIN en claro nunca toca
-- la base ni el repo.
--
-- OJO — qué protege y qué no (deuda consciente de fase 1):
--   El hash y el salt viajan al navegador, porque el PIN se valida SIN SEÑAL
--   contra el catálogo cacheado. 4 dígitos son 10 000 combinaciones: quien tenga
--   la key publishable las prueba todas en segundos. Esto es un candado de puerta,
--   no una caja fuerte. Sirve contra "capturé con el nombre del compa" y contra
--   equivocarse de agente; NO contra un atacante.
--   La caja fuerte es la fase 2: Supabase Auth + RLS (9999_rls_fase2.sql.txt).
--   Estas columnas no estorban para llegar ahí — conviven con agentes.user_id.
-- =============================================================================

alter table public.agentes
  add column if not exists pin_salt text,
  add column if not exists pin_hash text;

comment on column public.agentes.pin_salt is
  'Salt aleatorio por agente (hex). Se genera en set_pin_agente().';
comment on column public.agentes.pin_hash is
  'sha256(pin || pin_salt) en hex. El PIN en claro nunca se guarda.';

-- -----------------------------------------------------------------------------
-- set_pin_agente(agente, pin) — asigna o rota el PIN de un agente.
-- Genera salt nuevo en cada llamada, así rotar el PIN invalida el anterior.
-- Se usa desde alta_cliente.sql y para cambiar un PIN olvidado.
--
-- Ejemplo:
--   select public.set_pin_agente(
--     (select id from public.agentes where nombre = 'NOMBRE DEL AGENTE'),
--     '1234'
--   );
-- -----------------------------------------------------------------------------
create or replace function public.set_pin_agente(p_agente uuid, p_pin text)
returns void
language plpgsql
security definer
-- search_path fijo: en Supabase pgcrypto (digest, gen_random_bytes) vive en el
-- esquema `extensions`. Fijarlo evita que la función dependa del search_path
-- de quien la llame.
set search_path = public, extensions
as $$
declare
  v_salt text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'El PIN debe ser exactamente 4 dígitos (recibido: %)', coalesce(p_pin, 'null');
  end if;

  v_salt := encode(gen_random_bytes(16), 'hex');

  update public.agentes
     set pin_salt = v_salt,
         pin_hash = encode(digest(p_pin || v_salt, 'sha256'), 'hex')
   where id = p_agente;

  if not found then
    raise exception 'No existe el agente %', p_agente;
  end if;
end;
$$;

comment on function public.set_pin_agente(uuid, text) is
  'Asigna/rota el PIN de 4 dígitos de un agente. Guarda solo salt + sha256(pin||salt).';
