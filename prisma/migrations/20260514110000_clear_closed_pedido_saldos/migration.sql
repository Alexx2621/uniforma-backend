UPDATE `PedidoProduccion`
SET `saldoPendiente` = 0
WHERE LOWER(TRIM(COALESCE(`estado`, ''))) IN ('anulado', 'recibido', 'completado')
  AND COALESCE(`saldoPendiente`, 0) <> 0;
