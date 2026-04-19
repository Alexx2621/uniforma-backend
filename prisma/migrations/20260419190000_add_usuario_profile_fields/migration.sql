ALTER TABLE `Usuario`
    ADD COLUMN `primerNombre` VARCHAR(191) NULL,
    ADD COLUMN `segundoNombre` VARCHAR(191) NULL,
    ADD COLUMN `primerApellido` VARCHAR(191) NULL,
    ADD COLUMN `segundoApellido` VARCHAR(191) NULL,
    ADD COLUMN `telefono` VARCHAR(191) NULL,
    ADD COLUMN `dpi` VARCHAR(191) NULL,
    ADD COLUMN `direccion` VARCHAR(191) NULL,
    ADD COLUMN `fechaNacimiento` DATETIME(3) NULL,
    ADD COLUMN `fotoUrl` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Usuario_dpi_key` ON `Usuario`(`dpi`);
