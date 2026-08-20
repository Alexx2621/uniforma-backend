/**
 * Cliente para los Cron Jobs de cPanel. Lee el secreto de la configuracion
 * privada del backend y llama al endpoint HTTPS sin exponerlo en la linea de
 * comandos ni guardarlo en los logs.
 *
 * Uso:
 *   node scripts/ejecutar-automatizacion.js alertas
 *   node scripts/ejecutar-automatizacion.js consistencia
 */
const fs = require('fs');

const API = process.env.UNIFORMA_API_URL || 'https://api.uniformaguatemala.com';
const ENV_LOCAL = '/home/unirfoma/uniforma-api/.env';
const HTACCESS = '/home/unirfoma/api.uniformaguatemala.com/.htaccess';
const REGISTRO = '/home/unirfoma/uniforma-api/cron-automatizaciones.log';
const DIRECTORIO_BLOQUEOS = '/home/unirfoma/uniforma-api/tmp';

const trabajos = {
  alertas: '/alertas-cron/programadas',
  consistencia: '/consistencia-cron/revisar',
};

function valorArchivo(ruta, nombre) {
  if (!fs.existsSync(ruta)) return null;
  const contenido = fs.readFileSync(ruta, 'utf8');
  const env = contenido.match(new RegExp(`^\\s*${nombre}\\s*=\\s*(.+)$`, 'm'));
  const apache = contenido.match(
    new RegExp(`^\\s*SetEnv\\s+${nombre}\\s+(.+)$`, 'm'),
  );
  const valor = env?.[1] || apache?.[1] || '';
  return valor.trim().replace(/^["']|["']$/g, '') || null;
}

function leerToken() {
  for (const nombre of ['OPERACIONES_CRON_TOKEN', 'ALERTAS_CRON_TOKEN']) {
    const valor =
      process.env[nombre] ||
      valorArchivo(ENV_LOCAL, nombre) ||
      valorArchivo(HTACCESS, nombre);
    if (valor) return valor;
  }
  return null;
}

function anotar(texto) {
  const linea = `[${new Date().toISOString()}] ${texto}`;
  console.log(linea);
  try {
    if (fs.existsSync(REGISTRO) && fs.statSync(REGISTRO).size > 512000) {
      const lineas = fs.readFileSync(REGISTRO, 'utf8').split('\n').slice(-1000);
      fs.writeFileSync(REGISTRO, lineas.join('\n'));
    }
    fs.appendFileSync(REGISTRO, `${linea}\n`);
  } catch (_) {}
}

function adquirirBloqueo(trabajo) {
  const ruta = `${DIRECTORIO_BLOQUEOS}/cron-${trabajo}.lock`;
  const maxEdadMs = trabajo === 'consistencia' ? 300000 : 120000;

  for (let intento = 0; intento < 2; intento += 1) {
    try {
      const descriptor = fs.openSync(ruta, 'wx');
      fs.writeFileSync(
        descriptor,
        JSON.stringify({
          pid: process.pid,
          iniciadoEn: new Date().toISOString(),
        }),
      );
      return { descriptor, ruta };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const edadMs = Date.now() - fs.statSync(ruta).mtimeMs;
        if (edadMs > maxEdadMs && intento === 0) {
          fs.unlinkSync(ruta);
          continue;
        }
      } catch (_) {
        if (intento === 0) continue;
      }
      return null;
    }
  }
  return null;
}

function liberarBloqueo(bloqueo) {
  if (!bloqueo) return;
  try {
    fs.closeSync(bloqueo.descriptor);
  } catch (_) {}
  try {
    fs.unlinkSync(bloqueo.ruta);
  } catch (_) {}
}

async function main() {
  const trabajo = `${process.argv[2] || ''}`.toLowerCase();
  const ruta = trabajos[trabajo];
  if (!ruta) {
    throw new Error('Trabajo invalido. Usa alertas o consistencia');
  }

  const token = leerToken();
  if (!token) {
    throw new Error(
      'No se encontro OPERACIONES_CRON_TOKEN ni ALERTAS_CRON_TOKEN',
    );
  }

  const bloqueo = adquirirBloqueo(trabajo);
  if (!bloqueo) {
    anotar(`${trabajo} OMITIDO: ya existe una ejecucion activa`);
    return;
  }

  try {
    const inicio = Date.now();
    const response = await fetch(`${API.replace(/\/$/, '')}${ruta}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-cron-token': token,
      },
      signal: AbortSignal.timeout(trabajo === 'consistencia' ? 180000 : 60000),
    });
    const cuerpo = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${cuerpo.slice(0, 300)}`);
    }

    let resultado = cuerpo;
    try {
      const parsed = JSON.parse(cuerpo);
      resultado = JSON.stringify(parsed.resultado || { ok: parsed.ok });
    } catch (_) {}
    anotar(
      `${trabajo} OK en ${Date.now() - inicio} ms · ${resultado.slice(0, 300)}`,
    );
  } finally {
    liberarBloqueo(bloqueo);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    anotar(`ERROR: ${error?.message || error}`);
    process.exit(1);
  },
);
