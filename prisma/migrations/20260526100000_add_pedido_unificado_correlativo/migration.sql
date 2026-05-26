ALTER TABLE `PedidoProduccion`
  ADD COLUMN `unificadoCorrelativo` VARCHAR(191) NULL;

CREATE INDEX `PedidoProduccion_unificadoCorrelativo_idx` ON `PedidoProduccion`(`unificadoCorrelativo`);

UPDATE `PedidoProduccion` p
JOIN (
  SELECT pup.`pedidoId`, MIN(pu.`correlativo`) AS `correlativo`
  FROM `ProduccionUnificadoPedido` pup
  JOIN `ProduccionUnificado` pu ON pu.`id` = pup.`produccionUnificadoId`
  GROUP BY pup.`pedidoId`
) u ON u.`pedidoId` = p.`id`
SET p.`unificadoCorrelativo` = u.`correlativo`
WHERE p.`unificadoCorrelativo` IS NULL;
