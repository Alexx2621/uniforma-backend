# Automatizaciones en cPanel

El backend registra cada ejecucion, su duracion, resultado y error en Salud
operativa. El secreto se lee desde `/home/unirfoma/uniforma-api/.env` o desde
el `.htaccess`; no se escribe en el comando ni en el historial HTTP.

Configurar una sola variable privada con un valor largo y aleatorio:

```text
OPERACIONES_CRON_TOKEN=REEMPLAZAR_POR_UN_SECRETO_LARGO
```

`ALERTAS_CRON_TOKEN` sigue siendo compatible para no interrumpir el trabajo
existente. No es necesario configurar ambas variables.

## Trabajos de cPanel

Alertas programadas, cada cinco minutos:

```cron
*/5 * * * * /opt/cpanel/ea-nodejs22/bin/node /home/unirfoma/uniforma-api/scripts/ejecutar-automatizacion.js alertas >/dev/null 2>&1
```

Revision de consistencia, todos los dias a las 02:15:

```cron
15 2 * * * /opt/cpanel/ea-nodejs22/bin/node /home/unirfoma/uniforma-api/scripts/ejecutar-automatizacion.js consistencia >/dev/null 2>&1
```

Si cPanel muestra otra ruta de Node.js en **Setup Node.js App**, sustituir
solamente `/opt/cpanel/ea-nodejs22/bin/node`. Las ejecuciones tambien quedan
en `/home/unirfoma/uniforma-api/cron-automatizaciones.log`.
