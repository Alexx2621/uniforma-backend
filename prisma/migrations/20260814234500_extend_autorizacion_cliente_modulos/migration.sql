ALTER TABLE `AutorizacionVentaCliente`
  ADD COLUMN `modulo` VARCHAR(191) NOT NULL DEFAULT 'venta',
  ADD COLUMN `operacionId` INTEGER NULL;

-- Dos correcciones respecto a la version inicial:
--   1. El indice nuevo se crea ANTES de borrar el viejo. La clave foranea
--      sobre solicitanteId necesita un indice que la respalde en todo
--      momento; al reves, MySQL aborta con el error 1553.
--   2. Nombre explicito y mas corto: el que genera Prisma por defecto ocupa
--      66 caracteres y MySQL solo admite 64 (error 1059).
CREATE INDEX `AutorizacionVentaCliente_solicitante_cliente_modulo_estado_idx`
  ON `AutorizacionVentaCliente`(`solicitanteId`, `clienteId`, `modulo`, `estado`);

DROP INDEX `AutorizacionVentaCliente_solicitanteId_clienteId_estado_idx` ON `AutorizacionVentaCliente`;
