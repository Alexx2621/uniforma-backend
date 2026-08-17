/**
 * Respaldo diario de la base de datos, comprimido y con rotacion.
 *
 * Existe porque JetBackup del hosting dejo de generar copias el 4 de junio de
 * 2026, asi que no hay ninguna red bajo los datos actuales.
 *
 * Se ejecuta desde un trabajo de cron. Guarda en /home/unirfoma/respaldos,
 * fuera de public_html para que no quede accesible desde internet, conserva
 * los ultimos DIAS_A_CONSERVAR y borra los anteriores.
 *
 * La contrasena se pasa a mysqldump por MYSQL_PWD, nunca en la linea de
 * comandos: de lo contrario cualquiera con acceso al servidor podria verla
 * en la lista de procesos.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const DESTINO = '/home/unirfoma/respaldos';
const REGISTRO = '/home/unirfoma/respaldos/respaldos.log';
const HTACCESS = '/home/unirfoma/api.uniformaguatemala.com/.htaccess';
const ENV_LOCAL = '/home/unirfoma/uniforma-api/.env';
const MYSQLDUMP = '/usr/bin/mysqldump';
const DIAS_A_CONSERVAR = 7;

function delArchivo(ruta, patron) {
  if (!fs.existsSync(ruta)) return null;
  const m = fs.readFileSync(ruta, 'utf8').match(patron);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

function anotar(linea) {
  const texto = `[${new Date().toISOString()}] ${linea}`;
  console.log(texto);
  try { fs.appendFileSync(REGISTRO, texto + '\n'); } catch (_) {}
}

async function main() {
  if (!fs.existsSync(DESTINO)) fs.mkdirSync(DESTINO, { recursive: true, mode: 0o700 });

  const url = process.env.DATABASE_URL
    || delArchivo(ENV_LOCAL, /^\s*DATABASE_URL\s*=\s*(.+)$/m)
    || delArchivo(HTACCESS, /^\s*SetEnv\s+DATABASE_URL\s+(.+)$/m);
  if (!url) throw new Error('No se encontro DATABASE_URL');

  const u = new URL(url);
  const base = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const fecha = new Date().toISOString().slice(0, 10);
  const archivo = path.join(DESTINO, `uniforma-${fecha}.sql.gz`);
  const parcial = archivo + '.parcial';

  anotar(`Respaldando ${base} -> ${path.basename(archivo)}`);

  const args = [
    '--single-transaction', '--routines', '--triggers',
    '--no-tablespaces', '--default-character-set=utf8mb4',
    '-h', u.hostname, '-P', String(u.port || 3306),
    '-u', decodeURIComponent(u.username),
    base,
  ];

  const codigo = await new Promise((resolve) => {
    const proc = spawn(MYSQLDUMP, args, {
      env: { ...process.env, MYSQL_PWD: decodeURIComponent(u.password) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errores = '';
    proc.stderr.on('data', (d) => { errores += String(d); });
    // Se escribe a un archivo .parcial y se renombra al final: si el proceso
    // muere a medias, no queda un respaldo truncado con aspecto de valido.
    proc.stdout.pipe(zlib.createGzip()).pipe(fs.createWriteStream(parcial))
      .on('finish', () => resolve({ code: proc.exitCode, errores }))
      .on('error', (e) => resolve({ code: 1, errores: e.message }));
    proc.on('error', (e) => resolve({ code: 1, errores: e.message }));
  });

  if (codigo.code !== 0) {
    try { fs.unlinkSync(parcial); } catch (_) {}
    throw new Error(`mysqldump fallo (codigo ${codigo.code}): ${String(codigo.errores).slice(0, 200)}`);
  }

  const bytes = fs.statSync(parcial).size;
  if (bytes < 10240) {
    fs.unlinkSync(parcial);
    throw new Error(`El respaldo pesa solo ${bytes} bytes: se descarta por sospechoso`);
  }

  fs.renameSync(parcial, archivo);
  anotar(`Listo: ${(bytes / 1048576).toFixed(2)} MB`);

  // Rotacion
  const copias = fs.readdirSync(DESTINO)
    .filter((f) => /^uniforma-\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(f))
    .sort()
    .reverse();
  const sobrantes = copias.slice(DIAS_A_CONSERVAR);
  sobrantes.forEach((f) => {
    fs.unlinkSync(path.join(DESTINO, f));
    anotar(`Eliminado por antiguedad: ${f}`);
  });
  anotar(`Copias conservadas: ${Math.min(copias.length, DIAS_A_CONSERVAR)}`);
}

main().catch((e) => {
  anotar('ERROR: ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
});
