-- AlterTable
ALTER TABLE `notificacionconfig` ADD COLUMN `crossStoreRoleIds` JSON NULL,
    ADD COLUMN `disabledPaths` JSON NULL,
    ADD COLUMN `pedidoAlertRoleIds` JSON NULL,
    ADD COLUMN `productMassConfig` JSON NULL,
    ADD COLUMN `productionInternalMode` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `unifyOrderRoleIds` JSON NULL,
    ADD COLUMN `userDisabledPaths` JSON NULL;
