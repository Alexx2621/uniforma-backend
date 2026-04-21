-- Agrega observacion por linea en detalle de venta
ALTER TABLE `DetalleVenta`
ADD COLUMN `descripcion` VARCHAR(191) NULL DEFAULT '';
