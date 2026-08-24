/**
 * Cierra las conexiones MySQL ociosas de la aplicacion.
 *
 * El servidor tiene wait_timeout de 8 horas, asi que cada reinicio deja atras
 * sus conexiones y se acumulan hasta agotar el limite de 20 del plan. A partir
 * de ahi Prisma falla con el error 1203 y pantallas como la de nuevo pedido
 * dejan de cargar sus catalogos.
 *
 * Solo mata conexiones en estado Sleep del propio usuario, y nunca la suya.
 * Las activas no se tocan.
 *
 * Usa mysql2 porque el motor de Prisma no arranca en el ejecutor de scripts
 * de cPanel (PANIC: timer has gone away).
 */
const fs = require('fs');
const mysql = require('mysql2/promise');

const REGISTRO = '/home/unirfoma/uniforma-api/conexiones.log';
const ENV_LOCAL = '/home/unirfoma/uniforma-api/.env';
const HTACCESS = '/home/unirfoma/api.uniformaguatemala.com/.htaccess';
const SEGUNDOS_OCIOSA = Number(process.env.SEGUNDOS_OCIOSA || 60);

const salida = [];
const anotar = (l) => { salida.push(l); console.log(l); };
const CORTE_MS = 20000;
const corteForzado = setTimeout(() => {
  anotar(`ERROR: la limpieza supero ${CORTE_MS / 1000}s y fue terminada`);
  try { fs.appendFileSync(REGISTRO, salida.join('\n') + '\n\n'); } catch (_) {}
  process.exit(1);
}, CORTE_MS);
corteForzado.unref();

function delArchivo(ruta, patron) {
  if (!fs.existsSync(ruta)) return null;
  const m = fs.readFileSync(ruta, 'utf8').match(patron);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

async function main() {
  anotar(`=== ${new Date().toISOString()} ===`);
  const url =
    process.env.DATABASE_URL ||
    delArchivo(ENV_LOCAL, /^\s*DATABASE_URL\s*=\s*(.+)$/m) ||
    delArchivo(HTACCESS, /^\s*SetEnv\s+DATABASE_URL\s+(.+)$/m);
  if (!url) throw new Error('No se encontro DATABASE_URL');

  const u = new URL(url);
  let cn;
  try {
    cn = await mysql.createConnection({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '').split('?')[0]),
      connectTimeout: 5000,
    });

  const [propia] = await cn.query('SELECT CONNECTION_ID() AS id');
  const miId = Number(propia[0].id);

  const [antes] = await cn.query(
    "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE USER = SUBSTRING_INDEX(CURRENT_USER(), '@', 1)",
  );
  anotar(`  conexiones antes : ${antes[0].n}`);

  const [ociosas] = await cn.query(
    `SELECT ID, TIME FROM information_schema.PROCESSLIST
      WHERE USER = SUBSTRING_INDEX(CURRENT_USER(), '@', 1)
        AND COMMAND = 'Sleep' AND TIME >= ? AND ID <> ?
      ORDER BY TIME DESC`,
    [SEGUNDOS_OCIOSA, miId],
  );
  anotar(`  ociosas (>= ${SEGUNDOS_OCIOSA}s) : ${ociosas.length}`);

  let cerradas = 0;
  for (const fila of ociosas) {
    try {
      await cn.query(`KILL ${Number(fila.ID)}`);
      cerradas++;
    } catch (e) {
      anotar(`  no se pudo cerrar ${fila.ID}: ${e.code || e.message}`);
    }
  }

  const [despues] = await cn.query(
    "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE USER = SUBSTRING_INDEX(CURRENT_USER(), '@', 1)",
  );
  anotar('');
  anotar(`  cerradas         : ${cerradas}`);
  anotar(`  conexiones ahora : ${despues[0].n}`);
  } finally {
    if (cn) {
      try {
        await cn.end();
      } catch (_) {
        try { cn.destroy(); } catch (_) {}
      }
    }
  }
}

main()
  .catch((e) => { anotar('ERROR: ' + (e && e.message ? e.message : e)); process.exitCode = 1; })
  .finally(() => {
    clearTimeout(corteForzado);
    try { fs.appendFileSync(REGISTRO, salida.join('\n') + '\n\n'); } catch (_) {}
  });
