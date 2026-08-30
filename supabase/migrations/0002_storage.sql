-- =============================================================================
-- 0002_storage.sql — Bucket de almacenamiento para evidencias (fotos)
-- -----------------------------------------------------------------------------
-- Bucket PRIVADO: las fotos no se sirven públicas. En fase 1 se accede con la
-- key de servicio / URLs firmadas desde el backend. Las policies finas de
-- Storage por cliente van en 9999_rls_fase2.sql.txt.
--
-- Convención de ruta (para aislar por cliente desde ya):
--   evidencias/{cliente_id}/{visita_id}/{evidencia_id}.jpg
--
-- Costo: el gasto real del producto es storage + egress de imágenes. Comprimir
-- SIEMPRE en el cliente antes de subir (ver reglas en CLAUDE.md).
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', false)
on conflict (id) do nothing;
