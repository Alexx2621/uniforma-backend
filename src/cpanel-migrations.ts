import { createHash, randomUUID } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import mysql from 'mysql2/promise';

type MigrationStatus = 'ok' | 'aplicada' | 'bloqueada' | 'error' | 'omitida';

export type MigrationStartupReport = {
  checkedAt: string;
  status: MigrationStatus;
  applied: string[];
  pending: string[];
  blocked: string[];
  checksumMismatch: string[];
  message: string;
};

let startupReport: MigrationStartupReport = {
  checkedAt: new Date().toISOString(),
  status: 'omitida',
  applied: [],
  pending: [],
  blocked: [],
  checksumMismatch: [],
  message: 'El gestor de migraciones aun no se ha ejecutado',
};

const migrationsRoot = () => join(process.cwd(), 'prisma', 'migrations');

function localMigrations() {
  const root = migrationsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(root, entry.name, 'migration.sql')),
    )
    .map((entry) => {
      const path = join(root, entry.name, 'migration.sql');
      const sql = readFileSync(path, 'utf8');
      return {
        name: entry.name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getStartupMigrationReport() {
  return { ...startupReport };
}

/**
 * Aplica migraciones futuras en cPanel sin depender del motor de Prisma CLI.
 *
 * Es deliberadamente conservador: solo ejecuta migraciones posteriores a la
 * ultima ya aplicada. Un hueco historico puede significar que alguien hizo el
 * cambio manualmente, por lo que se informa en Salud operativa y no se intenta
 * adivinar. Cada ejecucion usa el mismo candado global y el mismo historial de
 * `_prisma_migrations` que Prisma.
 */
export async function runCpanelMigrations() {
  const checkedAt = new Date().toISOString();
  const report = (
    partial: Partial<MigrationStartupReport>,
  ): MigrationStartupReport => ({
    checkedAt,
    status: 'ok',
    applied: [],
    pending: [],
    blocked: [],
    checksumMismatch: [],
    message: 'Esquema actualizado',
    ...partial,
  });

  if (process.env.CPANEL_AUTO_MIGRATIONS === 'false') {
    startupReport = report({
      status: 'omitida',
      message: 'Migraciones automaticas desactivadas',
    });
    return startupReport;
  }

  const rawUrl = `${process.env.DATABASE_URL || ''}`.trim();
  if (!rawUrl) {
    startupReport = report({
      status: 'omitida',
      message: 'DATABASE_URL no esta configurada',
    });
    return startupReport;
  }

  const migrations = localMigrations();
  if (!migrations.length) {
    startupReport = report({
      status: 'bloqueada',
      message: 'No se encontraron archivos de migracion',
    });
    return startupReport;
  }

  const url = new URL(rawUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectTimeout: 15_000,
    multipleStatements: true,
  });

  let lockAcquired = false;
  try {
    const [lockRows]: any = await connection.query(
      'SELECT GET_LOCK(?, 30) AS acquired',
      ['uniforma_schema_migrations'],
    );
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired)
      throw new Error('No se pudo obtener el candado de migraciones');

    const [historyTable]: any = await connection.query(
      `SELECT 1 FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = '_prisma_migrations' LIMIT 1`,
      [database],
    );
    if (!historyTable.length) {
      startupReport = report({
        status: 'bloqueada',
        pending: migrations.map((migration) => migration.name),
        message:
          'Falta el historial de Prisma; se requiere definir una linea base antes de automatizar',
      });
      return startupReport;
    }

    const [rows]: any = await connection.query(
      `SELECT migration_name, checksum, finished_at, rolled_back_at, logs
       FROM _prisma_migrations ORDER BY migration_name ASC, started_at ASC`,
    );
    const failed = rows.filter(
      (row: any) => !row.finished_at && !row.rolled_back_at,
    );
    const appliedRows = rows.filter(
      (row: any) => row.finished_at && !row.rolled_back_at,
    );
    const appliedByName = new Map(
      appliedRows.map((row: any) => [String(row.migration_name), row]),
    );
    const latestApplied =
      appliedRows
        .map((row: any) => String(row.migration_name))
        .sort()
        .at(-1) || '';
    const pending = migrations.filter(
      (migration) => !appliedByName.has(migration.name),
    );
    const blocked = pending.filter(
      (migration) => !latestApplied || migration.name < latestApplied,
    );
    const checksumMismatch = migrations
      .filter((migration) => {
        const row: any = appliedByName.get(migration.name);
        return row?.checksum && String(row.checksum) !== migration.checksum;
      })
      .map((migration) => migration.name);

    if (failed.length) {
      startupReport = report({
        status: 'bloqueada',
        pending: pending.map((migration) => migration.name),
        blocked: failed.map((row: any) => String(row.migration_name)),
        checksumMismatch,
        message:
          'Existe una migracion fallida que requiere revision antes de continuar',
      });
      return startupReport;
    }

    if (blocked.length || checksumMismatch.length) {
      startupReport = report({
        status: 'bloqueada',
        pending: pending.map((migration) => migration.name),
        blocked: blocked.map((migration) => migration.name),
        checksumMismatch,
        message: blocked.length
          ? 'Hay migraciones historicas sin registrar; se requiere revision antes de continuar'
          : 'El contenido de una migracion aplicada ya no coincide con su checksum',
      });
      return startupReport;
    }

    const appliedNow: string[] = [];
    const candidates = pending.filter(
      (migration) => latestApplied && migration.name > latestApplied,
    );
    for (const migration of candidates) {
      const id = randomUUID();
      await connection.query(
        `INSERT INTO _prisma_migrations
          (id, checksum, migration_name, logs, rolled_back_at, started_at, finished_at, applied_steps_count)
         VALUES (?, ?, ?, NULL, NULL, NOW(3), NULL, 0)`,
        [id, migration.checksum, migration.name],
      );
      try {
        await connection.query(migration.sql);
        await connection.query(
          `UPDATE _prisma_migrations
           SET finished_at = NOW(3), applied_steps_count = 1
           WHERE id = ?`,
          [id],
        );
        appliedNow.push(migration.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await connection.query(
          'UPDATE _prisma_migrations SET logs = ? WHERE id = ?',
          [message.slice(0, 60_000), id],
        );
        startupReport = report({
          status: 'error',
          applied: appliedNow,
          pending: candidates
            .filter((item) => !appliedNow.includes(item.name))
            .map((item) => item.name),
          blocked: [migration.name, ...blocked.map((item) => item.name)],
          checksumMismatch,
          message: `Fallo la migracion ${migration.name}: ${message}`,
        });
        throw error;
      }
    }

    const unresolved = blocked.map((migration) => migration.name);
    startupReport = report({
      status:
        unresolved.length || checksumMismatch.length
          ? 'bloqueada'
          : appliedNow.length
            ? 'aplicada'
            : 'ok',
      applied: appliedNow,
      pending: unresolved,
      blocked: unresolved,
      checksumMismatch,
      message: unresolved.length
        ? 'Hay migraciones historicas sin registrar; no se modificaron automaticamente'
        : checksumMismatch.length
          ? 'Hay migraciones aplicadas cuyo contenido local cambio'
          : appliedNow.length
            ? `Se aplicaron ${appliedNow.length} migracion(es)`
            : 'Base de datos y migraciones sincronizadas',
    });
    return startupReport;
  } finally {
    if (lockAcquired) {
      await connection
        .query("SELECT RELEASE_LOCK('uniforma_schema_migrations')")
        .catch(() => undefined);
    }
    await connection.end();
  }
}
