-- Los parametros de consulta no forman parte de la identidad del endpoint y
-- pueden contener tokens de cron u otros datos sensibles. Desde este cambio
-- LogMiddleware solo guarda la ruta; esta limpieza corrige el historial.
UPDATE `LogAcceso`
SET `endpoint` = SUBSTRING_INDEX(`endpoint`, '?', 1)
WHERE INSTR(`endpoint`, '?') > 0;
