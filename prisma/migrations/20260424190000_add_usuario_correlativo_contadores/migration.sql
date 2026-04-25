ALTER TABLE `Usuario`
  ADD COLUMN `usuarioCorrelativo` VARCHAR(191) NULL;

ALTER TABLE `PedidoProduccion`
  ADD COLUMN `folio` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `PedidoProduccion_folio_key` ON `PedidoProduccion`(`folio`);

CREATE TABLE `UsuarioCorrelativoContador` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `usuarioId` INTEGER NOT NULL,
  `operacion` VARCHAR(191) NOT NULL,
  `prefijo` VARCHAR(191) NOT NULL,
  `codigoUsuario` VARCHAR(191) NOT NULL,
  `siguienteNumero` INTEGER NOT NULL DEFAULT 1,
  `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizadoEn` DATETIME(3) NOT NULL,

  UNIQUE INDEX `UsuarioCorrelativoContador_usuarioId_operacion_key`(`usuarioId`, `operacion`),
  INDEX `UsuarioCorrelativoContador_operacion_idx`(`operacion`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UsuarioCorrelativoContador`
  ADD CONSTRAINT `UsuarioCorrelativoContador_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
