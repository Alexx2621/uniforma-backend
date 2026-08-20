# Despliegue y operacion en cPanel

Referencia de lo que produccion **debe** tener configurado. Si algo se borra por
accidente, este documento es la fuente de verdad para restaurarlo.

> Los valores secretos no se guardan aqui. Los reales viven en el panel de Node.js
> de cPanel (`Software > Setup Node.js App > api.uniformaguatemala.com > Editar`)
> y quedan persistidos en `/home/unirfoma/.cl.selector/node-selector.json`.

## 1. Variables de entorno de la app Node

La aplicacion registrada es **`uniforma-api`** (raiz `/home/unirfoma/uniforma-api`,
Node 22, arranque `dist/src/main.js`, dominio `api.uniformaguatemala.com`).

| Variable               | Valor                                               | Para que sirve                                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | _(secreto)_                                         | Conexion MySQL. **Debe conservar `?connection_limit=2`**: el plan solo permite 20 conexiones por usuario y sin ese limite Prisma las agota y la API deja de responder con el error 1203.                                                                                                  |
| `ALERTAS_CRON_TOKEN`   | _(secreto)_                                         | Token compartido con el cron de alertas (seccion 2). Sin el, `POST /alertas-cron/programadas` responde 403 y las alertas programadas dejan de dispararse cuando Passenger duerme la app.                                                                                                  |
| `PDF_RENDERER_URL`     | `https://uniforma-pdf-renderer.onrender.com/render` | Servicio externo de PDF. cPanel **no puede** correr Chromium (su contenedor no reserva memoria para WebAssembly), por eso el render se delega afuera.                                                                                                                                     |
| `PDF_RENDERER_TOKEN`   | _(secreto)_                                         | Autenticacion contra ese servicio.                                                                                                                                                                                                                                                        |
| `RESEND_API_KEY`       | _(secreto)_                                         | Envio de correo (reportes y notificaciones).                                                                                                                                                                                                                                              |
| `GOOGLE_AI_API_KEY`    | _(secreto)_                                         | Interpreta las preguntas del asistente flotante (Google AI Studio, nivel gratuito). **Opcional**: si falta, el asistente sigue funcionando reconociendo folios por patron, solo entiende menos. Al modelo unicamente se le manda la frase escrita por el usuario, nunca datos de la base. |
| `GOOGLE_AI_MODELO`     | _(sin definir)_                                     | Solo para cambiar el modelo sin recompilar. Por defecto `gemini-3.5-flash-lite`. Ojo: la lista de modelos de Google incluye algunos que luego responden 404, hay que probar el que se ponga.                                                                                              |
| `UV_THREADPOOL_SIZE`   | `2`                                                 | Limita hilos de libuv.                                                                                                                                                                                                                                                                    |
| `TOKIO_WORKER_THREADS` | `2`                                                 | Limita hilos del motor de Prisma (Rust/Tokio).                                                                                                                                                                                                                                            |
| `RAYON_NUM_THREADS`    | `2`                                                 | Limita hilos de Rayon.                                                                                                                                                                                                                                                                    |

Las tres ultimas existen porque la cuenta tiene un **tope duro de 100 procesos/hilos
(NPROC)**. No son opcionales ni decorativas: se agregaron despues de una caida real
provocada por agotar ese tope.

### Trampa conocida del panel de cPanel

Guardar en la pantalla de Node.js **regenera todo el bloque de variables**. Ya
ocurrio dos veces que variables previamente configuradas desaparecieran solas tras
un guardado. **Siempre** verifica la lista completa despues de guardar, comparandola
contra la tabla de arriba.

## 2. Trabajos de cron

Deben existir exactamente estos dos (`Avanzada > Trabajos de cron`):

```
# Respaldo nocturno de la base de datos - 3:30 AM
30 3 * * * /home/unirfoma/nodevenv/uniforma-api/22/bin/node /home/unirfoma/uniforma-api/scripts/respaldar-bd.js >> /home/unirfoma/respaldos/respaldos-cron.log 2>&1
```

La salida va a un log **a proposito**. Antes iba a `/dev/null` y por eso el respaldo
estuvo fallando sin que nadie se enterara: no habia ni un archivo ni un error que
mirar. Si se vuelve a tocar este cron, conserva el log.

```
# Barrido de alertas programadas - cada 5 minutos
*/5 * * * * curl -s -m 30 -X POST -H "x-cron-token: TOKEN" https://api.uniformaguatemala.com/alertas-cron/programadas >/dev/null 2>&1
```

Sustituye `TOKEN` por el valor real de `ALERTAS_CRON_TOKEN`.

Cuando existe `ALERTAS_CRON_TOKEN` u `OPERACIONES_CRON_TOKEN`, el barrido interno
de 30 segundos se desactiva automaticamente. De esta forma solo trabaja el cron
de cPanel y cada instancia de Passenger no repite la misma consulta.

## 3. Verificacion de salud

```bash
curl -s https://api.uniformaguatemala.com/status
```

Respuesta sana:

```json
{
  "status": "online",
  "api": { "hilos": 12, "memoriaMB": 200 },
  "database": {
    "state": "online",
    "conexiones": { "enUso": 10, "limite": 20 }
  },
  "pdfRenderer": { "state": "online" }
}
```

Que mirar:

- **`hilos`** por encima de ~20 sugiere que faltan las variables de limite de hilos.
- **`conexiones.porcentaje`** >= 75 marca `conexionesAlLimite`; revisa que
  `connection_limit=2` siga en `DATABASE_URL`.
- **`pdfRenderer`** en `offline` significa que el servicio externo esta caido o que
  `PDF_RENDERER_URL` se perdio.

Para confirmar que el token de cron esta puesto, sin ejecutar nada:

```bash
curl -s -X POST https://api.uniformaguatemala.com/alertas-cron/programadas
```

- `"Token de cron invalido"` -> la variable existe (correcto).
- `"ALERTAS_CRON_TOKEN no esta configurado"` -> la variable se perdio.

### Como se verifica un despliegue (y por que no se hace por HTTP)

El hosting responde a las IP de GitHub Actions con una **pagina anti-bots**:
HTTP 200 y un redirect por JavaScript. Mirando solo el codigo de respuesta es
indistinguible de una respuesta real, asi que un chequeo por HTTP desde el
runner no sirve — daba rojo con la aplicacion perfectamente sana. El SSH de la
cuenta tampoco ejecuta comandos, solo transfiere archivos.

Por eso la aplicacion escribe `arranque.json` en su raiz al terminar de
levantar, y el despliegue lo baja por SFTP y compara su hora contra el instante
del reinicio:

- hora posterior al reinicio -> el codigo nuevo levanto (verde).
- hora anterior -> sigue corriendo la instancia vieja porque lo nuevo no
  levanto (rojo). Ahi hay que mirar `stderr.log` en el servidor.
- sin archivo tras 20 intentos -> lo mismo, rojo.

Es el mismo filtro anti-bots que a veces impide entrar al sistema desde ciertas
redes mientras desde datos moviles si entra. No se puede desactivar sin
soporte, y no se intenta esquivar.

## 4. Historial de causas raiz

Fallas reales ya diagnosticadas, para no volver a investigarlas desde cero:

1. **Agotamiento de NPROC (tope 100).** Causa de las caidas mas graves. Sintoma:
   todos los sitios de la cuenta (incluso los estaticos, no solo la API) responden
   con reset de conexion inmediato (~0.2s, no timeout), mientras cPanel en el
   puerto 2083 sigue accesible.

2. **App Node huerfana.** Existia una copia vieja del backend en
   `/home/unirfoma/uniforma-backend` que LiteSpeed seguia levantando (14 procesos,
   10MB cada uno, arrancando y muriendo en bucle) pese a **no** estar registrada en
   el selector de Node. Contribuia al agotamiento de NPROC. Eliminada.
   Si vuelve a aparecer algo asi, se detecta en
   `Metrica > Uso de Recursos > Instantanea > Lista de procesos`, buscando entradas
   `lsnode:` cuya ruta no sea `/home/unirfoma/uniforma-api/`.

3. **Variables borradas del panel.** Ver seccion 1.

4. **Respaldo nocturno fallando en silencio.** El cron mandaba su salida a
   `/dev/null`, asi que cuando el script fallaba no quedaba ni archivo ni rastro.
   Se detecto que `/home/unirfoma/respaldos` estaba **vacio**, sin una sola copia,
   mientras JetBackup del hosting tampoco genera copias desde el 4 de junio de 2026:
   la base no tenia ninguna red de seguridad. Verifica con:

   ```bash
   ls -la /home/unirfoma/respaldos    # deben verse uniforma-AAAA-MM-DD.sql.gz
   ```

   Una corrida sana tarda ~1.5s y pesa ~11 MB comprimidos.

5. **Bloqueo de IP por firewall del servidor.** Muchas peticiones fallidas seguidas
   desde una misma IP (por ejemplo, pantallas reintentando durante una caida) hacen
   que el firewall del servidor bloquee esa IP. Sintoma: el sitio carga bien desde
   datos moviles pero no desde la red de la oficina, con
   `PR_CONNECT_RESET_ERROR`. **No** se administra desde cPanel: el `Bloqueador de IP`
   de la cuenta no lo controla. Suele expirar solo.

## 5. Limites del plan

| Recurso                      | Limite     |
| ---------------------------- | ---------- |
| Procesos/hilos (NPROC)       | 100        |
| Entry Processes              | 30         |
| Memoria fisica               | 2 GB       |
| Conexiones MySQL por usuario | 20         |
| I/O                          | 48.83 MB/s |
| IOPS                         | 2048       |

NPROC es el unico que ha llegado a saturarse; el resto opera holgado.
