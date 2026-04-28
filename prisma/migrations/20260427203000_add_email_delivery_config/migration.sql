-- AlterTable
ALTER TABLE `NotificacionConfig`
    ADD COLUMN `smtpHost` VARCHAR(191) NULL DEFAULT 'smtp.gmail.com',
    ADD COLUMN `smtpPort` INTEGER NOT NULL DEFAULT 587,
    ADD COLUMN `smtpUser` VARCHAR(191) NULL,
    ADD COLUMN `smtpPass` VARCHAR(191) NULL,
    ADD COLUMN `smtpFrom` VARCHAR(191) NULL DEFAULT 'noreply@uniforma.com',
    ADD COLUMN `resendEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `resendApiKey` VARCHAR(191) NULL,
    ADD COLUMN `resendFrom` VARCHAR(191) NULL DEFAULT 'noreply@uniforma.com',
    ADD COLUMN `resendTemplateId` VARCHAR(191) NULL,
    ADD COLUMN `reportesConfig` JSON NULL;
