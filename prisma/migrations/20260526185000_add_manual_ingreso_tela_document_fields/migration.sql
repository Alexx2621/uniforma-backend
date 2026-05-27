ALTER TABLE `IngresoTela`
  ADD COLUMN `documentoTipo` VARCHAR(191) NULL DEFAULT 'factura',
  ADD COLUMN `documentoReferencia` VARCHAR(191) NULL,
  ADD COLUMN `documentoTotal` DOUBLE NOT NULL DEFAULT 0;

CREATE INDEX `IngresoTela_documentoTipo_idx` ON `IngresoTela`(`documentoTipo`);
CREATE INDEX `IngresoTela_documentoReferencia_idx` ON `IngresoTela`(`documentoReferencia`);
