UPDATE `PedidoProduccion` p
SET p.`usuarioId` = (
    SELECT u.`id`
    FROM `Usuario` u
    WHERE UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`usuario`))
       OR UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(u.`nombre`))
       OR UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(COALESCE(u.`usuarioCorrelativo`, '')))
       OR UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(REPLACE(REPLACE(REPLACE(u.`usuario`, '.', ' '), '_', ' '), '-', ' ')))
       OR UPPER(TRIM(u.`nombre`)) LIKE CONCAT(UPPER(TRIM(p.`solicitadoPor`)), '%')
       OR UPPER(TRIM(p.`solicitadoPor`)) LIKE CONCAT(UPPER(TRIM(u.`nombre`)), '%')
       OR UPPER(TRIM(p.`solicitadoPor`)) LIKE CONCAT(UPPER(TRIM(REPLACE(REPLACE(REPLACE(u.`usuario`, '.', ' '), '_', ' '), '-', ' '))), '%')
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
       OR UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(COALESCE(u.`usuarioCorrelativo`, '')))
       OR UPPER(TRIM(p.`solicitadoPor`)) = UPPER(TRIM(REPLACE(REPLACE(REPLACE(u.`usuario`, '.', ' '), '_', ' '), '-', ' ')))
       OR UPPER(TRIM(u.`nombre`)) LIKE CONCAT(UPPER(TRIM(p.`solicitadoPor`)), '%')
       OR UPPER(TRIM(p.`solicitadoPor`)) LIKE CONCAT(UPPER(TRIM(u.`nombre`)), '%')
       OR UPPER(TRIM(p.`solicitadoPor`)) LIKE CONCAT(UPPER(TRIM(REPLACE(REPLACE(REPLACE(u.`usuario`, '.', ' '), '_', ' '), '-', ' '))), '%')
  );
