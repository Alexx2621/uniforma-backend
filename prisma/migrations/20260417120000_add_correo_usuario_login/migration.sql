ALTER TABLE `Usuario`
    ADD COLUMN `correo` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Usuario_correo_key` ON `Usuario`(`correo`);
