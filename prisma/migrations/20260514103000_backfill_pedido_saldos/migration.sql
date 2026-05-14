UPDATE `PedidoProduccion` p
SET p.`saldoPendiente` = GREATEST(
  COALESCE(p.`totalEstimado`, 0) - GREATEST(
    COALESCE(p.`anticipo`, 0),
    COALESCE((
      SELECT SUM(COALESCE(pp.`monto`, 0) + COALESCE(pp.`recargo`, 0))
      FROM `PagoPedido` pp
      WHERE pp.`pedidoId` = p.`id`
    ), 0)
  ),
  0
)
WHERE COALESCE(p.`saldoPendiente`, 0) <= 0
  AND COALESCE(p.`totalEstimado`, 0) > GREATEST(
    COALESCE(p.`anticipo`, 0),
    COALESCE((
      SELECT SUM(COALESCE(pp.`monto`, 0) + COALESCE(pp.`recargo`, 0))
      FROM `PagoPedido` pp
      WHERE pp.`pedidoId` = p.`id`
    ), 0)
  )
  AND LOWER(TRIM(COALESCE(p.`estado`, ''))) NOT IN ('anulado', 'recibido', 'completado', 'regresado_produccion');
