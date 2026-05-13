ALTER TABLE `Cliente`
    ADD COLUMN `usuarioId` INTEGER NULL;

CREATE INDEX `Cliente_usuarioId_idx` ON `Cliente`(`usuarioId`);

ALTER TABLE `Cliente`
    ADD CONSTRAINT `Cliente_usuarioId_fkey`
    FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
