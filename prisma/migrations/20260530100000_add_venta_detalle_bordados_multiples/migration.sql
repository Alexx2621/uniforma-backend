CREATE TABLE `BordadoDetalleVenta` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `detalleId` INTEGER NOT NULL,
  `monto` DOUBLE NOT NULL DEFAULT 0,
  `color` VARCHAR(191) NULL,
  `tamano` VARCHAR(191) NULL,
  `posicion` VARCHAR(191) NULL,
  `observaciones` MEDIUMTEXT NULL,
  `imagenUrl` MEDIUMTEXT NULL,
  `estado` VARCHAR(191) NULL,
  `fechaEntrega` DATETIME(3) NULL,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  INDEX `BordadoDetalleVenta_detalleId_idx`(`detalleId`),
  INDEX `BordadoDetalleVenta_estado_idx`(`estado`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BordadoDetalleVenta`
  ADD CONSTRAINT `BordadoDetalleVenta_detalleId_fkey`
  FOREIGN KEY (`detalleId`) REFERENCES `DetalleVenta`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `BordadoDetalleVenta` (
  `detalleId`,
  `monto`,
  `color`,
  `tamano`,
  `posicion`,
  `observaciones`,
  `imagenUrl`,
  `estado`,
  `fechaEntrega`,
  `creadoEn`,
  `actualizadoEn`
)
SELECT
  `id`,
  COALESCE(`bordado`, 0),
  `bordadoColor`,
  `bordadoTamano`,
  `bordadoPosicion`,
  `bordadoObservaciones`,
  `bordadoImagenUrl`,
  COALESCE(`bordadoEstado`, 'EN PRODUCCION'),
  `bordadoFechaEntrega`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `DetalleVenta`
WHERE COALESCE(`bordado`, 0) > 0
  OR `bordadoColor` IS NOT NULL
  OR `bordadoTamano` IS NOT NULL
  OR `bordadoPosicion` IS NOT NULL
  OR `bordadoObservaciones` IS NOT NULL
  OR `bordadoImagenUrl` IS NOT NULL;
