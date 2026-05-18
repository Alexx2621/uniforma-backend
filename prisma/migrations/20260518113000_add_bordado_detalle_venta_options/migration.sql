ALTER TABLE `DetalleVenta`
  ADD COLUMN `bordadoColor` VARCHAR(191) NULL,
  ADD COLUMN `bordadoTamano` VARCHAR(191) NULL,
  ADD COLUMN `bordadoPosicion` VARCHAR(191) NULL,
  ADD COLUMN `bordadoObservaciones` MEDIUMTEXT NULL,
  ADD COLUMN `bordadoImagenUrl` MEDIUMTEXT NULL,
  ADD COLUMN `bordadoEstado` VARCHAR(191) NULL,
  ADD COLUMN `bordadoFechaEntrega` DATETIME(3) NULL;

UPDATE `DetalleVenta`
SET `bordadoEstado` = 'EN PRODUCCION'
WHERE `bordadoEstado` IS NULL
  AND COALESCE(`bordado`, 0) > 0;
