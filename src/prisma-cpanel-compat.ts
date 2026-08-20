import { createHash, randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import mysql from 'mysql2/promise';

const MIGRATION_NAME = '20260820040000_add_venta_especial';

/**
 * Repara la migracion que quedo fuera al pasar de Railway a cPanel.
 *
 * El hosting no permite ejecutar `prisma migrate deploy` por SSH. Esta rutina
 * usa la misma DATABASE_URL, toma un candado de MySQL y aplica exclusivamente
 * la estructura conocida que falta. Es idempotente y registra la migracion en
 * `_prisma_migrations` para que una ejecucion futura de Prisma no la repita.
 */
export async function ensureCpanelVentaEspecialSchema() {
  if (process.env.CPANEL_SCHEMA_REPAIR === 'false') return;
  const rawUrl = `${process.env.DATABASE_URL || ''}`.trim();
  if (!rawUrl) return;

  const url = new URL(rawUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectTimeout: 15_000,
  });

  try {
    const [lockRows]: any = await connection.query(
      'SELECT GET_LOCK(?, 20) AS acquired',
      ['uniforma_schema_repair'],
    );
    if (Number(lockRows?.[0]?.acquired || 0) !== 1) {
      throw new Error('No se pudo obtener el candado para actualizar el esquema');
    }

    const [ventaColumn]: any = await connection.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Venta' AND COLUMN_NAME = 'esVentaEspecial' LIMIT 1`,
      [database],
    );
    if (!ventaColumn.length) {
      await connection.query(
        'ALTER TABLE `Venta` ADD COLUMN `esVentaEspecial` BOOLEAN NOT NULL DEFAULT false',
      );
    }

    const [ventaIndex]: any = await connection.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Venta' AND INDEX_NAME = 'Venta_esVentaEspecial_fecha_idx' LIMIT 1`,
      [database],
    );
    if (!ventaIndex.length) {
      await connection.query(
        'CREATE INDEX `Venta_esVentaEspecial_fecha_idx` ON `Venta`(`esVentaEspecial`, `fecha`)',
      );
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`VentaEspecialAutorizacion\` (
        \`id\` INTEGER NOT NULL AUTO_INCREMENT,
        \`estado\` VARCHAR(191) NOT NULL DEFAULT 'pendiente',
        \`comentario\` MEDIUMTEXT NULL,
        \`respuestaComentario\` MEDIUMTEXT NULL,
        \`payload\` JSON NOT NULL,
        \`solicitadoPorId\` INTEGER NOT NULL,
        \`autorizadoPorId\` INTEGER NULL,
        \`ventaId\` INTEGER NULL,
        \`creadoEn\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`actualizadoEn\` DATETIME(3) NOT NULL,
        \`autorizadoEn\` DATETIME(3) NULL,
        INDEX \`VentaEspecialAutorizacion_estado_creadoEn_idx\`(\`estado\`, \`creadoEn\`),
        INDEX \`VentaEspecialAutorizacion_solicitadoPorId_creadoEn_idx\`(\`solicitadoPorId\`, \`creadoEn\`),
        INDEX \`VentaEspecialAutorizacion_autorizadoPorId_creadoEn_idx\`(\`autorizadoPorId\`, \`creadoEn\`),
        INDEX \`VentaEspecialAutorizacion_ventaId_idx\`(\`ventaId\`),
        PRIMARY KEY (\`id\`)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    const constraints = [
      {
        name: 'VentaEspecialAutorizacion_solicitadoPorId_fkey',
        sql: 'ALTER TABLE `VentaEspecialAutorizacion` ADD CONSTRAINT `VentaEspecialAutorizacion_solicitadoPorId_fkey` FOREIGN KEY (`solicitadoPorId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
      },
      {
        name: 'VentaEspecialAutorizacion_autorizadoPorId_fkey',
        sql: 'ALTER TABLE `VentaEspecialAutorizacion` ADD CONSTRAINT `VentaEspecialAutorizacion_autorizadoPorId_fkey` FOREIGN KEY (`autorizadoPorId`) REFERENCES `Usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
      },
      {
        name: 'VentaEspecialAutorizacion_ventaId_fkey',
        sql: 'ALTER TABLE `VentaEspecialAutorizacion` ADD CONSTRAINT `VentaEspecialAutorizacion_ventaId_fkey` FOREIGN KEY (`ventaId`) REFERENCES `Venta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
      },
    ];
    for (const constraint of constraints) {
      const [existing]: any = await connection.query(
        `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'VentaEspecialAutorizacion'
           AND CONSTRAINT_NAME = ? LIMIT 1`,
        [database, constraint.name],
      );
      if (!existing.length) await connection.query(constraint.sql);
    }

    const [migrationTable]: any = await connection.query(
      `SELECT 1 FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = '_prisma_migrations' LIMIT 1`,
      [database],
    );
    if (migrationTable.length) {
      const [registered]: any = await connection.query(
        'SELECT 1 FROM `_prisma_migrations` WHERE `migration_name` = ? LIMIT 1',
        [MIGRATION_NAME],
      );
      if (!registered.length) {
        const migrationPath = join(process.cwd(), 'prisma', 'migrations', MIGRATION_NAME, 'migration.sql');
        const checksum = existsSync(migrationPath)
          ? createHash('sha256').update(readFileSync(migrationPath)).digest('hex')
          : createHash('sha256').update(MIGRATION_NAME).digest('hex');
        await connection.query(
          `INSERT INTO \`_prisma_migrations\`
             (\`id\`, \`checksum\`, \`finished_at\`, \`migration_name\`, \`logs\`, \`rolled_back_at\`, \`started_at\`, \`applied_steps_count\`)
           VALUES (?, ?, NOW(3), ?, NULL, NULL, NOW(3), 1)`,
          [randomUUID(), checksum, MIGRATION_NAME],
        );
      }
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('uniforma_schema_repair')").catch(() => undefined);
    await connection.end();
  }
}
