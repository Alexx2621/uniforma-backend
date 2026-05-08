ALTER TABLE `NotificacionConfig`
  ADD COLUMN `salesInventoryEnabled` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `DetalleVenta`
  ADD COLUMN `estiloEspecial` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `estiloEspecialMonto` DOUBLE NOT NULL DEFAULT 0;
