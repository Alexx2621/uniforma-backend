ALTER TABLE `DetallePedidoProduccion`
  ADD COLUMN `bordadoEstado` VARCHAR(191) NULL,
  ADD COLUMN `bordadoFechaEntrega` DATETIME(3) NULL;

UPDATE `DetallePedidoProduccion`
SET `bordadoEstado` = 'EN PRODUCCION'
WHERE `bordadoEstado` IS NULL
  AND (
    COALESCE(`bordado`, 0) > 0
    OR `bordadoColor` IS NOT NULL
    OR `bordadoTamano` IS NOT NULL
    OR `bordadoPosicion` IS NOT NULL
    OR `bordadoImagenUrl` IS NOT NULL
  );
