-- =============================================================================
-- 0007_precision_gps.sql — Guardar la precisión de la lectura de GPS
-- -----------------------------------------------------------------------------
-- El dato YA se mide y YA viaja en la cola del teléfono:
--   * `gps.ts` lo devuelve en `Ubicacion.precision` (metros, de coords.accuracy),
--   * `tipos.ts` lo lleva como `precision_gps` en la visita encolada,
--   * `captura-ui.ts` lo guarda al armar la visita y lo enseña en pantalla.
-- Pero `sync.ts` no lo mandaba, porque esta columna no existía: se tiraba en
-- cada sincronización. Van 82 visitas sin él.
--
-- PARA QUÉ SIRVE, ADEMÁS DE INFORMAR
--
-- Es el mejor indicio disponible de una ubicación falsa. La API de geolocalización
-- del navegador NO expone si el fix vino de un proveedor simulado —eso existe en
-- Android nativo (isFromMockProvider), pero Chrome no se lo pasa a la página—, así
-- que no hay forma directa de detectarlo desde una PWA.
--
-- Lo que sí delata a un GPS falso es el COMPORTAMIENTO de la precisión: la real
-- varía con el techo, el clima y los satélites a la vista (±8 m en la calle, ±40
-- adentro de una plaza); la simulada suele venir constante y perfecta, el mismo
-- valor en un sótano que en un estacionamiento. Sin la columna no se puede ni
-- notar.
--
-- Nulo permitido: las 82 visitas anteriores no lo traen, y una lectura sin
-- precisión reportada es posible. El tablero muestra "—", no inventa un número.
--
-- COSTO: 4 bytes por visita. Cero llamadas nuevas.
-- =============================================================================

alter table public.visitas
  add column if not exists precision_gps real;

comment on column public.visitas.precision_gps is
  'Radio de incertidumbre de la lectura de GPS, en metros (coords.accuracy). '
  'Nulo en las visitas anteriores a esta migración y cuando el dispositivo no lo reporta.';
