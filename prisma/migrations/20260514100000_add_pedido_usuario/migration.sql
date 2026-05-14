ALTER TABLE `PedidoProduccion`
  ADD COLUMN `usuarioId` INTEGER NULL;

UPDATE `PedidoProduccion` p
SET p.`usuarioId` = (
    SELECT u.`id`
    FROM `Usuario` u
    WHERE UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`usuario`))
       OR UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`nombre`))
    ORDER BY u.`id` ASC
    LIMIT 1
)
WHERE p.`usuarioId` IS NULL
  AND p.`solicitadoPor` IS NOT NULL
  AND TRIM(p.`solicitadoPor`) <> ''
  AND EXISTS (
    SELECT 1
    FROM `Usuario` u
    WHERE UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`usuario`))
       OR UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`nombre`))
  );

CREATE INDEX `PedidoProduccion_usuarioId_fecha_idx` ON `PedidoProduccion`(`usuarioId`, `fecha`);

ALTER TABLE `PedidoProduccion`
  ADD CONSTRAINT `PedidoProduccion_usuarioId_fkey`
  FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
