/**
 * Pone en cero el stock de todos los productos de una bodega.
 *
 * Por defecto SIMULA: informa que cambiaria y no toca nada. Solo aplica si se
 * le pasa --ejecutar, para que nadie vacie un inventario por accidente.
 *
 * Usa mysql2 y no Prisma a proposito: el motor de Prisma revienta con
 * "PANIC: timer has gone away" al arrancar dentro del ejecutor de scripts de
 * cPanel. Bajo Passenger funciona, pero aqui no, asi que se habla SQL directo.
 *
 * Registra el ajuste en MovInventario con la convencion del sistema (tipo
 * 'conteo_ajuste' y la diferencia en negativo, igual que inventario.service.ts
 * al cerrar un conteo), para que el historial explique la baja.
 *
 * Uso:
 *   node poner-stock-en-cero.js --bodega 6
 *   node poner-stock-en-cero.js --bodega 6 --ejecutar
 */
const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

const ENV_LOCAL = '/home/unirfoma/uniforma-api/.env';
const HTACCESS = '/home/unirfoma/api.uniformaguatemala.com/.htaccess';
const REGISTRO = '/home/unirfoma/uniforma-api/stock-en-cero.log';

const args = process.argv.slice(2);
const leerArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BODEGA_ID = Number(leerArg('--bodega') || 0);
const EJECUTAR = args.includes('--ejecutar');

const salida = [];
const anotar = (l) => { salida.push(l); console.log(l); };

function delArchivo(ruta, patron) {
  if (!fs.existsSync(ruta)) return null;
  const m = fs.readFileSync(ruta, 'utf8').match(patron);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

async function main() {
  if (!BODEGA_ID) throw new Error('Falta --bodega <id>');

  const url =
    process.env.DATABASE_URL ||
    delArchivo(ENV_LOCAL, /^\s*DATABASE_URL\s*=\s*(.+)$/m) ||
    delArchivo(HTACCESS, /^\s*SetEnv\s+DATABASE_URL\s+(.+)$/m);
  if (!url) throw new Error('No se encontro DATABASE_URL');

  const u = new URL(url);
  const cn = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  });

  anotar(`=== ${new Date().toISOString()} ===`);
  anotar(EJECUTAR ? 'MODO: EJECUCION REAL' : 'MODO: SIMULACION (no se modifica nada)');

  const [bodegas] = await cn.query('SELECT id, nombre FROM Bodega WHERE id = ?', [BODEGA_ID]);
  if (!bodegas.length) throw new Error(`No existe la bodega ${BODEGA_ID}`);
  anotar(`Bodega ${bodegas[0].id}: ${bodegas[0].nombre}`);

  const [totales] = await cn.query('SELECT COUNT(*) AS n FROM Inventario WHERE bodegaId = ?', [BODEGA_ID]);
  const [conStock] = await cn.query(
    `SELECT i.productoId, i.stock, p.nombre
       FROM Inventario i
       LEFT JOIN Producto p ON p.id = i.productoId
      WHERE i.bodegaId = ? AND i.stock <> 0
      ORDER BY i.stock DESC`,
    [BODEGA_ID],
  );
  const unidades = conStock.reduce((s, r) => s + Number(r.stock), 0);

  anotar('');
  anotar(`Productos registrados en la bodega : ${totales[0].n}`);
  anotar(`Productos con stock distinto de 0  : ${conStock.length}`);
  anotar(`Unidades que se descontarian       : ${unidades}`);

  if (conStock.length) {
    anotar('');
    anotar('Los 10 de mayor stock:');
    conStock.slice(0, 10).forEach((r) =>
      anotar(`  ${String(r.stock).padStart(6)}  ${r.nombre || 'producto ' + r.productoId}`),
    );
    if (conStock.length > 10) anotar(`  ... y ${conStock.length - 10} mas`);
  }

  // Si la bodega no tiene ninguna fila de inventario, conviene saber si el
  // dato vive en otro sitio antes de concluir que esta vacia.
  if (Number(totales[0].n) === 0) {
    anotar('');
    anotar('--- Diagnostico: la bodega no tiene filas en Inventario ---');

    const [reparto] = await cn.query(
      `SELECT b.id, b.nombre, COUNT(i.id) AS filas, COALESCE(SUM(i.stock), 0) AS unidades
         FROM Bodega b LEFT JOIN Inventario i ON i.bodegaId = b.id
        GROUP BY b.id, b.nombre ORDER BY b.id`,
    );
    anotar('Inventario por bodega:');
    reparto.forEach((r) =>
      anotar(`  ${String(r.id).padStart(3)}  ${String(r.filas).padStart(6)} filas  ${String(r.unidades).padStart(8)} uds  ${r.nombre}`),
    );

    const [movs] = await cn.query(
      'SELECT COUNT(*) AS n, COALESCE(SUM(cantidad), 0) AS saldo FROM MovInventario WHERE bodegaId = ?',
      [BODEGA_ID],
    );
    anotar('');
    anotar(`Movimientos historicos de esta bodega : ${movs[0].n} (saldo ${movs[0].saldo})`);
    anotar('Si hay movimientos pero no filas de Inventario, el stock se');
    anotar('calcula en otro lado y este script no seria el ajuste correcto.');
  }

  if (!EJECUTAR) {
    anotar('');
    anotar('SIMULACION: no se modifico nada. Para aplicar, usar stock-cero-APLICAR');
    await cn.end();
    return;
  }

  if (!conStock.length) {
    anotar('');
    anotar('No hay nada que ajustar: todo ya esta en cero.');
    await cn.end();
    return;
  }

  const referencia = `Ajuste a cero bodega ${BODEGA_ID} - ${new Date().toISOString().slice(0, 10)}`;

  // Transaccion: o se ajusta el stock y queda su rastro, o no se hace nada.
  await cn.beginTransaction();
  try {
    await cn.query(
      'INSERT INTO MovInventario (bodegaId, productoId, tipo, cantidad, fecha, referencia) VALUES ?',
      [conStock.map((r) => [BODEGA_ID, r.productoId, 'conteo_ajuste', -Number(r.stock), new Date(), referencia])],
    );
    const [res] = await cn.query('UPDATE Inventario SET stock = 0 WHERE bodegaId = ?', [BODEGA_ID]);
    await cn.commit();

    anotar('');
    anotar('AJUSTE APLICADO');
    anotar(`  Movimientos registrados : ${conStock.length}`);
    anotar(`  Filas de stock tocadas  : ${res.affectedRows}`);
    anotar(`  Referencia              : ${referencia}`);
  } catch (e) {
    await cn.rollback();
    throw e;
  }

  const [restantes] = await cn.query(
    'SELECT COUNT(*) AS n FROM Inventario WHERE bodegaId = ? AND stock <> 0',
    [BODEGA_ID],
  );
  anotar(`  Productos con stock restante : ${restantes[0].n}`);
  await cn.end();
}

main()
  .catch((e) => {
    anotar('ERROR: ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.appendFileSync(REGISTRO, salida.join('\n') + '\n\n'); } catch (_) {}
  });
