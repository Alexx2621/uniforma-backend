ALTER TABLE `DetallePedidoProduccion`
  ADD COLUMN `estiloEspecial` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `estiloEspecialMonto` DOUBLE NOT NULL DEFAULT 0;
