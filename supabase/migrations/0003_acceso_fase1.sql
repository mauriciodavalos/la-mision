-- =============================================================================
-- 0003_acceso_fase1.sql — Acceso al Storage para FASE 1 (prototipo)
-- -----------------------------------------------------------------------------
-- storage.objects trae RLS activada por defecto en Supabase, así que sin policy
-- la key publishable NO puede subir ni leer fotos. En fase 1 (sin auth todavía)
-- abrimos el bucket 'evidencias' a los roles anon/authenticated.
--
-- OJO — deuda consciente de fase 1: esto permite escribir/leer en el bucket con la
-- key pública. Es aceptable en prototipo (aislamiento por consulta), NO en producción.
-- La fase 2 (9999_rls_fase2.sql.txt) reemplaza estas policies por unas que atan cada
-- archivo al cliente del agente (primer segmento de la ruta = cliente_id).
--
-- Las tablas de datos NO necesitan policy aquí: su RLS está desactivada en fase 1.
-- =============================================================================

create policy "fase1 evidencias insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'evidencias');

create policy "fase1 evidencias select" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'evidencias');

-- upsert=true en la subida puede actualizar un objeto existente (reintentos idempotentes).
create policy "fase1 evidencias update" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'evidencias')
  with check (bucket_id = 'evidencias');
