UPDATE `Cliente` c
SET c.`usuarioId` = (
    SELECT u.`id`
    FROM `Venta` v
    INNER JOIN `Usuario` u
        ON UPPER(TRIM(v.`vendedor`)) = UPPER(TRIM(u.`usuario`))
        OR UPPER(TRIM(v.`vendedor`)) = UPPER(TRIM(u.`nombre`))
    WHERE v.`clienteId` = c.`id`
      AND v.`vendedor` IS NOT NULL
      AND TRIM(v.`vendedor`) <> ''
    ORDER BY v.`fecha` DESC, v.`id` DESC
    LIMIT 1
)
WHERE c.`usuarioId` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `Venta` v
    INNER JOIN `Usuario` u
        ON UPPER(TRIM(v.`vendedor`)) = UPPER(TRIM(u.`usuario`))
        OR UPPER(TRIM(v.`vendedor`)) = UPPER(TRIM(u.`nombre`))
    WHERE v.`clienteId` = c.`id`
      AND v.`vendedor` IS NOT NULL
      AND TRIM(v.`vendedor`) <> ''
  );

UPDATE `Cliente` c
SET c.`usuarioId` = (
    SELECT u.`id`
    FROM `PedidoProduccion` p
    INNER JOIN `Usuario` u
        ON UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`usuario`))
        OR UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`nombre`))
    WHERE p.`clienteId` = c.`id`
      AND p.`solicitadoPor` IS NOT NULL
      AND TRIM(p.`solicitadoPor`) <> ''
    ORDER BY p.`fecha` DESC, p.`id` DESC
    LIMIT 1
)
WHERE c.`usuarioId` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `PedidoProduccion` p
    INNER JOIN `Usuario` u
        ON UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`usuario`))
        OR UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`nombre`))
    WHERE p.`clienteId` = c.`id`
      AND p.`solicitadoPor` IS NOT NULL
      AND TRIM(p.`solicitadoPor`) <> ''
  );
