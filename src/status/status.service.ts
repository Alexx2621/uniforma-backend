import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma.service';
import { getStartupMigrationReport } from '../cpanel-migrations';

// El renderizador de PDF vive fuera del hosting: cPanel no puede ejecutar
// Chromium porque su contenedor no consigue instanciar WebAssembly.
const PDF_RENDERER_TIMEOUT_MS = 8000;

type ServiceState = 'online' | 'degraded' | 'offline' | 'unknown';

@Injectable()
export class StatusService {
  constructor(private prisma: PrismaService) {}

  private assertAdmin(user?: { rol?: string | null }) {
    if (`${user?.rol || ''}`.toUpperCase() !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo administradores pueden ver el detalle del servidor',
      );
    }
  }

  async getStatus() {
    const checkedAt = new Date().toISOString();
    const [database, pdfRenderer] = await Promise.all([
      this.checkDatabase(),
      this.checkPdfRenderer(),
    ]);

    const status: ServiceState = !database.ok
      ? 'degraded'
      : database.conexionesAlLimite || pdfRenderer.state === 'degraded'
        ? 'degraded'
        : 'online';

    return {
      status,
      checkedAt,
      api: {
        ok: true,
        state: 'online' as ServiceState,
        uptimeSeconds: Math.round(process.uptime()),
        environment: process.env.NODE_ENV || 'production',
        ...this.getUsoDeHilos(),
      },
      database,
      pdfRenderer,
    };
  }

  async getDetails(user?: { rol?: string | null }) {
    this.assertAdmin(user);

    const checkedAt = new Date().toISOString();
    const [
      globalStatusRows,
      variableRows,
      databaseSizeRows,
      processRows,
      migrations,
    ] = await Promise.all([
      this.getMysqlStatusRows(),
      this.getMysqlVariableRows(),
      this.safeQuery<any[]>(
        `SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes FROM information_schema.tables WHERE table_schema = DATABASE()`,
        [],
      ),
      this.safeQuery<any[]>(
        `SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, LEFT(INFO, 180) AS INFO FROM information_schema.PROCESSLIST ORDER BY TIME DESC LIMIT 12`,
        [],
      ),
      this.getRecentMigrations(),
    ]);

    const status = this.rowsToMap(globalStatusRows);
    const variables = this.rowsToMap(variableRows);
    const databaseBytes = this.toNumber(
      databaseSizeRows?.[0]?.bytes || databaseSizeRows?.[0]?.BYTES,
    );

    return {
      checkedAt,
      api: {
        uptimeSeconds: Math.round(process.uptime()),
        environment: process.env.NODE_ENV || 'production',
        memory: process.memoryUsage(),
      },
      mysql: {
        status,
        variables,
        databaseBytes,
        processlist: processRows.map((row) => ({
          id: Number(row.ID || 0),
          user: row.USER,
          host: row.HOST,
          database: row.DB,
          command: row.COMMAND,
          timeSeconds: Number(row.TIME || 0),
          state: row.STATE,
          info: row.INFO,
        })),
        migrations,
      },
    };
  }

  async getOperationalAudit(user?: { rol?: string | null }) {
    this.assertAdmin(user);
    const checkedAt = new Date().toISOString();
    const [
      details,
      services,
      tableSizes,
      inconsistencies,
      drafts,
      migrations,
      production,
    ] = await Promise.all([
      this.getDetails(user),
      this.getStatus(),
      this.getTableSizes(),
      this.getInconsistencies(),
      this.getDraftSummary(),
      this.getRecentMigrations(20),
      this.getProductionStatus(),
    ]);

    return {
      checkedAt,
      details,
      services,
      tableSizes,
      inconsistencies,
      drafts,
      migrations,
      production,
    };
  }

  private async getProductionStatus() {
    const [migrations, crons, recentErrors] = await Promise.all([
      this.getMigrationCompatibility(),
      this.getCronStatus(),
      this.getRecentServerErrors(),
    ]);
    return {
      deployment: this.getDeploymentInfo(),
      prisma: this.getPrismaCompatibility(),
      migrations,
      backups: this.getBackupStatus(),
      crons,
      recentErrors,
    };
  }

  private readJson(path: string) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }

  private schemaFingerprint(path: string) {
    try {
      const canonical = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/\/?.*$/gm, '')
        .replace(/\s+/g, '');
      return createHash('sha256').update(canonical).digest('hex');
    } catch {
      return null;
    }
  }

  private getDeploymentInfo() {
    const metadata = this.readJson(join(process.cwd(), 'version.json')) || {};
    const pkg = this.readJson(join(process.cwd(), 'package.json')) || {};
    return {
      version: metadata.version || pkg.version || 'N/D',
      commit: metadata.commit || process.env.GIT_COMMIT || null,
      builtAt: metadata.builtAt || null,
      deploymentRun: metadata.deploymentRun || null,
      node: process.version,
      environment: process.env.NODE_ENV || 'production',
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  private getPrismaCompatibility() {
    const projectSchema = join(process.cwd(), 'prisma', 'schema.prisma');
    const clientSchema = join(
      process.cwd(),
      'node_modules',
      '.prisma',
      'client',
      'schema.prisma',
    );
    // Prisma guarda en el cliente una copia autoformateada del esquema. Una
    // comparacion byte a byte daria una falsa alarma por espacios o comentarios
    // aunque los modelos sean identicos; la huella canonica compara estructura.
    const projectHash = this.schemaFingerprint(projectSchema);
    const clientHash = this.schemaFingerprint(clientSchema);
    const clientPackage =
      this.readJson(
        join(
          process.cwd(),
          'node_modules',
          '@prisma',
          'client',
          'package.json',
        ),
      ) || {};
    const compatible = Boolean(
      projectHash && clientHash && projectHash === clientHash,
    );
    return {
      ok: compatible,
      status: compatible ? 'sincronizado' : 'desactualizado',
      clientVersion: clientPackage.version || null,
      schemaHash: projectHash?.slice(0, 12) || null,
      clientSchemaHash: clientHash?.slice(0, 12) || null,
      message: compatible
        ? 'El cliente cargado corresponde al esquema desplegado'
        : 'El cliente Prisma no corresponde al esquema desplegado',
    };
  }

  private localMigrationFiles() {
    const root = join(process.cwd(), 'prisma', 'migrations');
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(join(root, entry.name, 'migration.sql')),
      )
      .map((entry) => {
        const path = join(root, entry.name, 'migration.sql');
        return {
          name: entry.name,
          checksum: createHash('sha256')
            .update(readFileSync(path))
            .digest('hex'),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async getMigrationCompatibility() {
    const local = this.localMigrationFiles();
    const rows = await this.safeQuery<any[]>(
      `SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, logs
       FROM _prisma_migrations ORDER BY migration_name ASC, started_at ASC`,
      [],
    );
    const applied = rows.filter(
      (row) => row.finished_at && !row.rolled_back_at,
    );
    const appliedByName = new Map(
      applied.map((row) => [String(row.migration_name), row]),
    );
    const pending = local
      .filter((migration) => !appliedByName.has(migration.name))
      .map((migration) => migration.name);
    const failed = rows
      .filter((row) => !row.finished_at && !row.rolled_back_at)
      .map((row) => ({
        name: String(row.migration_name),
        logs: row.logs || null,
        startedAt: row.started_at,
      }));
    const checksumMismatch = local
      .filter((migration) => {
        const row: any = appliedByName.get(migration.name);
        return row?.checksum && String(row.checksum) !== migration.checksum;
      })
      .map((migration) => migration.name);
    const startup = getStartupMigrationReport();
    const ok =
      rows.length > 0 &&
      pending.length === 0 &&
      failed.length === 0 &&
      checksumMismatch.length === 0;
    return {
      ok,
      status: ok ? 'sincronizadas' : 'requiere_atencion',
      localTotal: local.length,
      appliedTotal: applied.length,
      pending,
      failed,
      checksumMismatch,
      startup,
    };
  }

  private getBackupStatus() {
    const directory =
      process.env.BACKUP_DIRECTORY || '/home/unirfoma/respaldos';
    try {
      const files = readdirSync(directory)
        .filter((name) => /^uniforma-\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(name))
        .map((name) => {
          const stats = statSync(join(directory, name));
          return {
            name,
            bytes: stats.size,
            modifiedAt: stats.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      const latest = files[0] || null;
      const ageHours = latest
        ? Math.round(
            ((Date.now() - new Date(latest.modifiedAt).getTime()) / 3_600_000) *
              10,
          ) / 10
        : null;
      const stale = ageHours === null || ageHours > 30;
      return {
        available: true,
        ok: Boolean(latest) && !stale && latest.bytes >= 10_240,
        stale,
        directory,
        count: files.length,
        latest,
        ageHours,
        message: !latest
          ? 'No se encontraron respaldos'
          : stale
            ? 'El ultimo respaldo tiene mas de 30 horas'
            : 'Respaldo diario disponible',
      };
    } catch {
      return {
        available: false,
        ok: false,
        stale: null,
        directory,
        count: 0,
        latest: null,
        ageHours: null,
        message: 'El directorio de respaldos no existe o no es accesible',
      };
    }
  }

  private async getCronStatus() {
    const rows = await this.safeQuery<any[]>(
      `SELECT endpoint, fecha, resultado
       FROM LogAcceso
       WHERE endpoint LIKE '/alertas-cron/programadas%'
          OR endpoint LIKE '/consistencia/revisar%'
       ORDER BY fecha DESC LIMIT 100`,
      [],
    );
    const definitions = [
      {
        key: 'alertas',
        label: 'Alertas programadas',
        path: '/alertas-cron/programadas',
        maxAgeHours: 1,
      },
      {
        key: 'consistencia',
        label: 'Revisión de consistencia',
        path: '/consistencia/revisar',
        maxAgeHours: 30,
      },
    ];
    return definitions.map((definition) => {
      const latest = rows.find(
        (row) => String(row.endpoint || '').split('?')[0] === definition.path,
      );
      const lastRunAt = latest?.fecha
        ? new Date(latest.fecha).toISOString()
        : null;
      const ageHours = lastRunAt
        ? Math.round(
            ((Date.now() - new Date(lastRunAt).getTime()) / 3_600_000) * 10,
          ) / 10
        : null;
      const success = `${latest?.resultado || ''}`.startsWith('2');
      const stale = ageHours === null || ageHours > definition.maxAgeHours;
      return {
        ...definition,
        ok: Boolean(latest) && success && !stale,
        lastRunAt,
        lastResult: latest?.resultado || null,
        ageHours,
        stale,
      };
    });
  }

  private async getRecentServerErrors() {
    const rows = await this.safeQuery<any[]>(
      `SELECT id, usuario, endpoint, metodo, fecha, resultado
       FROM LogAcceso
       WHERE resultado LIKE '5%'
         AND fecha >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       ORDER BY fecha DESC LIMIT 12`,
      [],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      usuario: row.usuario || 'Sistema',
      endpoint: String(row.endpoint || '').split('?')[0],
      metodo: row.metodo,
      fecha: row.fecha,
      resultado: row.resultado,
    }));
  }

  private async checkDatabase() {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const conexiones = await this.getUsoDeConexiones();
      return {
        ok: true,
        state: 'online' as ServiceState,
        latencyMs: Date.now() - startedAt,
        ...conexiones,
      };
    } catch (error) {
      return {
        ok: false,
        state: 'offline' as ServiceState,
        latencyMs: Date.now() - startedAt,
        conexiones: null,
        conexionesAlLimite: false,
        message:
          error instanceof Error
            ? error.message
            : 'No se pudo consultar la base de datos',
      };
    }
  }

  private async safeQuery<T>(query: string, fallback: T): Promise<T> {
    try {
      return await this.prisma.$queryRawUnsafe<T>(query);
    } catch {
      return fallback;
    }
  }

  private async getMysqlStatusRows() {
    const names = [
      'Threads_connected',
      'Max_used_connections',
      'Created_tmp_disk_tables',
      'Created_tmp_tables',
      'Uptime',
      'Questions',
      'Slow_queries',
    ];
    const fromPerformanceSchema = await this.safeQuery<any[]>(
      `SELECT VARIABLE_NAME AS Variable_name, VARIABLE_VALUE AS Value
       FROM performance_schema.global_status
       WHERE VARIABLE_NAME IN (${names.map((name) => `'${name.toUpperCase()}'`).join(',')})`,
      [],
    );
    if (fromPerformanceSchema.length) return fromPerformanceSchema;

    return this.safeQuery<any[]>(
      `SHOW GLOBAL STATUS WHERE Variable_name IN (${names.map((name) => `'${name}'`).join(',')})`,
      [],
    );
  }

  private async getMysqlVariableRows() {
    const names = [
      'max_connections',
      'innodb_buffer_pool_size',
      'tmp_table_size',
      'max_heap_table_size',
      'sort_buffer_size',
      'join_buffer_size',
    ];
    const fromPerformanceSchema = await this.safeQuery<any[]>(
      `SELECT VARIABLE_NAME AS Variable_name, VARIABLE_VALUE AS Value
       FROM performance_schema.global_variables
       WHERE VARIABLE_NAME IN (${names.map((name) => `'${name.toUpperCase()}'`).join(',')})`,
      [],
    );
    if (fromPerformanceSchema.length) return fromPerformanceSchema;

    return this.safeQuery<any[]>(
      `SHOW VARIABLES WHERE Variable_name IN (${names.map((name) => `'${name}'`).join(',')})`,
      [],
    );
  }

  private async getRecentMigrations(limit = 5) {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT migration_name, started_at, finished_at, rolled_back_at, logs
         FROM _prisma_migrations
         ORDER BY started_at DESC
         LIMIT ${Math.min(Math.max(Number(limit) || 5, 1), 50)}`,
      );
      return rows.map((row) => ({
        name: row.migration_name,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        rolledBackAt: row.rolled_back_at,
        status: row.rolled_back_at
          ? 'revertida'
          : row.finished_at
            ? 'aplicada'
            : 'pendiente',
        logs: row.logs,
      }));
    } catch {
      return [];
    }
  }

  private async getTableSizes() {
    const rows = await this.safeQuery<any[]>(
      `SELECT
          table_name AS tableName,
          table_rows AS rowsApprox,
          data_length + index_length AS bytes
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
       ORDER BY bytes DESC
       LIMIT 12`,
      [],
    );
    return rows.map((row) => ({
      tableName: row.tableName || row.TABLE_NAME,
      rowsApprox: this.toNumber(row.rowsApprox || row.TABLE_ROWS),
      bytes: this.toNumber(row.bytes || row.BYTES),
    }));
  }

  private async getDraftSummary() {
    const rows = await this.safeQuery<any[]>(
      `SELECT
          estado,
          tipoDocumento,
          COUNT(*) AS total,
          MIN(actualizadoEn) AS oldestUpdatedAt,
          MAX(actualizadoEn) AS newestUpdatedAt
       FROM documentoborrador
       GROUP BY estado, tipoDocumento
       ORDER BY estado ASC, total DESC`,
      [],
    );
    const oldOpenRows = await this.safeQuery<any[]>(
      `SELECT COUNT(*) AS total
       FROM documentoborrador
       WHERE estado = 'abierto' AND actualizadoEn < DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [],
    );
    const lockedRows = await this.safeQuery<any[]>(
      `SELECT COUNT(*) AS total
       FROM documentoborrador
       WHERE estado = 'abierto' AND bloqueadoHasta IS NOT NULL AND bloqueadoHasta > NOW()`,
      [],
    );
    return {
      byType: rows.map((row) => ({
        estado: row.estado,
        tipoDocumento: row.tipoDocumento,
        total: this.toNumber(row.total),
        oldestUpdatedAt: row.oldestUpdatedAt,
        newestUpdatedAt: row.newestUpdatedAt,
      })),
      abiertosAntiguos: this.toNumber(oldOpenRows?.[0]?.total),
      bloqueadosActivos: this.toNumber(lockedRows?.[0]?.total),
    };
  }

  /**
   * Los chequeos sin el envoltorio de auditoria, para que ConsistenciaService
   * los registre y avise. La auditoria completa sigue siendo solo de admin;
   * esto es la deteccion en crudo.
   */
  getInconsistenciasPublicas() {
    return this.getInconsistencies();
  }

  private async getInconsistencies() {
    const checks = await Promise.all([
      this.buildCountCheck(
        'inventario_negativo',
        'Inventario negativo',
        'Hay productos con stock menor a cero.',
        'critica',
        `SELECT COUNT(*) AS total FROM Inventario WHERE stock < 0`,
        `SELECT i.bodegaId, b.nombre AS bodega, i.productoId, p.codigo, p.nombre AS producto, i.stock
         FROM Inventario i
         LEFT JOIN Bodega b ON b.id = i.bodegaId
         LEFT JOIN Producto p ON p.id = i.productoId
         WHERE i.stock < 0
         ORDER BY i.stock ASC
         LIMIT 50`,
      ),
      this.buildCountCheck(
        'productos_sin_stock_max',
        'Productos sin stock maximo',
        'Hay productos sin objetivo de stock configurado.',
        'media',
        `SELECT COUNT(*) AS total FROM Producto WHERE COALESCE(stockMax, 0) <= 0`,
        `SELECT id, codigo, nombre, tipo
         FROM Producto
         WHERE COALESCE(stockMax, 0) <= 0
         ORDER BY nombre ASC
         LIMIT 50`,
      ),
      this.buildCountCheck(
        'pedidos_total_inconsistente',
        'Pedidos con total diferente al detalle',
        'El total del pedido no cuadra contra sus lineas, envio y recargo.',
        'alta',
        `SELECT COUNT(*) AS total
         FROM PedidoProduccion p
         LEFT JOIN (
           SELECT pedidoId, SUM(cantidad * (((precioUnit + IF(estiloEspecial = 1, estiloEspecialMonto, 0)) * (1 - descuento / 100)) + bordado)) AS detalleTotal
           FROM DetallePedidoProduccion
           GROUP BY pedidoId
         ) d ON d.pedidoId = p.id
         WHERE LOWER(COALESCE(p.estado, '')) <> 'anulado'
           AND ABS(COALESCE(d.detalleTotal, 0) + COALESCE(p.envio, 0) + COALESCE(p.recargo, 0) - COALESCE(p.totalEstimado, 0)) > 0.05`,
        `SELECT p.id, p.folio, p.estado, p.fecha,
                ROUND(COALESCE(d.detalleTotal, 0), 2) AS sumaLineas,
                ROUND(COALESCE(p.envio, 0), 2) AS envio,
                ROUND(COALESCE(p.recargo, 0), 2) AS recargo,
                ROUND(COALESCE(p.totalEstimado, 0), 2) AS totalRegistrado,
                ROUND(COALESCE(d.detalleTotal, 0) + COALESCE(p.envio, 0) + COALESCE(p.recargo, 0) - COALESCE(p.totalEstimado, 0), 2) AS diferencia
         FROM PedidoProduccion p
         LEFT JOIN (
           SELECT pedidoId, SUM(cantidad * (((precioUnit + IF(estiloEspecial = 1, estiloEspecialMonto, 0)) * (1 - descuento / 100)) + bordado)) AS detalleTotal
           FROM DetallePedidoProduccion
           GROUP BY pedidoId
         ) d ON d.pedidoId = p.id
         WHERE LOWER(COALESCE(p.estado, '')) <> 'anulado'
           AND ABS(COALESCE(d.detalleTotal, 0) + COALESCE(p.envio, 0) + COALESCE(p.recargo, 0) - COALESCE(p.totalEstimado, 0)) > 0.05
         ORDER BY ABS(COALESCE(d.detalleTotal, 0) + COALESCE(p.envio, 0) + COALESCE(p.recargo, 0) - COALESCE(p.totalEstimado, 0)) DESC
         LIMIT 50`,
      ),
      this.buildCountCheck(
        'ventas_total_inconsistente',
        'Ventas con total diferente al detalle',
        'El total de la venta no cuadra contra sus lineas, envio y recargo.',
        'alta',
        `SELECT COUNT(*) AS total
         FROM Venta v
         LEFT JOIN (
           SELECT ventaId, SUM(subtotal) AS detalleTotal
           FROM DetalleVenta
           GROUP BY ventaId
         ) d ON d.ventaId = v.id
         WHERE ABS(COALESCE(d.detalleTotal, 0) + COALESCE(v.envio, 0) + COALESCE(v.recargo, 0) - COALESCE(v.total, 0)) > 0.05`,
        `SELECT v.id, v.folio, v.fecha, v.bodegaId, b.nombre AS bodega, v.vendedor,
                ROUND(COALESCE(d.detalleTotal, 0), 2) AS sumaLineas,
                ROUND(COALESCE(v.envio, 0), 2) AS envio,
                ROUND(COALESCE(v.recargo, 0), 2) AS recargo,
                ROUND(COALESCE(v.total, 0), 2) AS totalRegistrado,
                ROUND(COALESCE(d.detalleTotal, 0) + COALESCE(v.envio, 0) + COALESCE(v.recargo, 0) - COALESCE(v.total, 0), 2) AS diferencia
         FROM Venta v
         LEFT JOIN Bodega b ON b.id = v.bodegaId
         LEFT JOIN (
           SELECT ventaId, SUM(subtotal) AS detalleTotal
           FROM DetalleVenta
           GROUP BY ventaId
         ) d ON d.ventaId = v.id
         WHERE ABS(COALESCE(d.detalleTotal, 0) + COALESCE(v.envio, 0) + COALESCE(v.recargo, 0) - COALESCE(v.total, 0)) > 0.05
         ORDER BY ABS(COALESCE(d.detalleTotal, 0) + COALESCE(v.envio, 0) + COALESCE(v.recargo, 0) - COALESCE(v.total, 0)) DESC
         LIMIT 50`,
      ),
      this.buildCountCheck(
        'pagos_pedido_mayor_total',
        'Pedidos con pagos mayores al total',
        'Hay pedidos donde la suma de pagos supera el total estimado.',
        'alta',
        `SELECT COUNT(*) AS total
         FROM PedidoProduccion p
         JOIN (
           SELECT pedidoId, SUM(monto) AS totalPagado
           FROM PagoPedido
           GROUP BY pedidoId
         ) pagos ON pagos.pedidoId = p.id
         WHERE pagos.totalPagado - COALESCE(p.totalEstimado, 0) > 0.05`,
        `SELECT p.id, p.folio, p.estado,
                ROUND(pagos.totalPagado, 2) AS totalPagado,
                ROUND(COALESCE(p.totalEstimado, 0), 2) AS totalEstimado,
                ROUND(pagos.totalPagado - COALESCE(p.totalEstimado, 0), 2) AS excedente
         FROM PedidoProduccion p
         JOIN (
           SELECT pedidoId, SUM(monto) AS totalPagado
           FROM PagoPedido
           GROUP BY pedidoId
         ) pagos ON pagos.pedidoId = p.id
         WHERE pagos.totalPagado - COALESCE(p.totalEstimado, 0) > 0.05
         ORDER BY (pagos.totalPagado - COALESCE(p.totalEstimado, 0)) DESC
         LIMIT 50`,
      ),
      this.buildCountCheck(
        'orden_mixta_con_saldo_negativo',
        'Ordenes mixtas con saldo negativo',
        'Hay ordenes mixtas donde los pagos o asignaciones dejaron saldo menor a cero.',
        'alta',
        `SELECT COUNT(*) AS total FROM ordenmixta WHERE COALESCE(saldoTotal, 0) < -0.05`,
        `SELECT id, folio, estado, fecha, clienteNombre,
                ROUND(COALESCE(subtotalVenta, 0), 2) AS subtotalVenta,
                ROUND(COALESCE(subtotalPedido, 0), 2) AS subtotalPedido,
                ROUND(COALESCE(total, 0), 2) AS total,
                ROUND(COALESCE(anticipoTotal, 0), 2) AS anticipoTotal,
                ROUND(COALESCE(saldoTotal, 0), 2) AS saldoTotal
         FROM ordenmixta
         WHERE COALESCE(saldoTotal, 0) < -0.05
         ORDER BY saldoTotal ASC
         LIMIT 50`,
      ),
    ]);

    return checks;
  }

  /**
   * Un chequeo de consistencia.
   *
   * `detalleQuery` es opcional pero es lo que hace accionable el hallazgo:
   * saber que hay tres ventas descuadradas no sirve de nada si no se sabe
   * cuales son. Devuelve una muestra acotada para no cargar la respuesta
   * cuando el problema afecta a muchos registros.
   */
  private async buildCountCheck(
    key: string,
    title: string,
    description: string,
    severity: string,
    query: string,
    detalleQuery?: string,
  ) {
    const rows = await this.safeQuery<any[]>(query, []);
    const count = this.toNumber(rows?.[0]?.total ?? rows?.[0]?.TOTAL);

    const registros =
      count > 0 && detalleQuery
        ? (await this.safeQuery<any[]>(detalleQuery, [])).map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([campo, valor]) => [
                campo,
                typeof valor === 'bigint' ? Number(valor) : valor,
              ]),
            ),
          )
        : [];

    return {
      key,
      title,
      description,
      severity,
      count,
      ok: count === 0,
      registros,
      muestraParcial: registros.length > 0 && count > registros.length,
    };
  }

  private rowsToMap(rows: Array<Record<string, unknown>>) {
    return rows.reduce<Record<string, string>>((acc, row) => {
      const key = `${row.Variable_name ?? row.VARIABLE_NAME ?? ''}`;
      const value =
        row.Value ??
        row.VALUE ??
        row.Variable_value ??
        row.VARIABLE_VALUE ??
        '';
      if (key) {
        acc[key] = `${value}`;
        acc[key.toLowerCase()] = `${value}`;
      }
      return acc;
    }, {});
  }

  private toNumber(value: unknown) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Comprueba el servicio externo que convierte el HTML de los reportes en PDF.
   *
   * Sustituye a la antigua consulta del estado publico de Railway, que dejo de
   * tener sentido al migrar. Este si es una dependencia real: si se cae, los 4
   * reportes dejan de generarse.
   */
  private async checkPdfRenderer() {
    const configurado = (process.env.PDF_RENDERER_URL || '').trim();

    if (!configurado) {
      return {
        ok: true,
        configurado: false,
        state: 'online' as ServiceState,
        label: 'No configurado: los PDF se generan en este mismo servidor',
        latencyMs: 0,
      };
    }

    // PDF_RENDERER_URL apunta a /render; el sondeo va a /health.
    const url = configurado.replace(/\/render\/?$/, '') + '/health';
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      PDF_RENDERER_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        return {
          ok: false,
          configurado: true,
          state: 'degraded' as ServiceState,
          label: `Responde con error ${response.status}`,
          latencyMs,
          url,
        };
      }

      // El plan gratuito duerme el servicio tras 15 minutos sin uso y despertarlo
      // cuesta decenas de segundos, asi que una respuesta lenta es un aviso util.
      const lento = latencyMs > 3000;
      return {
        ok: true,
        configurado: true,
        state: 'online' as ServiceState,
        label: lento
          ? `Disponible, pero lento (${latencyMs} ms)`
          : 'Disponible',
        latencyMs,
        url,
      };
    } catch (error) {
      return {
        ok: false,
        configurado: true,
        state: 'degraded' as ServiceState,
        label: 'No responde: los reportes en PDF fallaran',
        latencyMs: Date.now() - startedAt,
        url,
        message:
          error instanceof Error ? error.message : 'Consulta no disponible',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Hilos y memoria de este proceso.
   *
   * CloudLinux cuenta HILOS contra el limite de procesos de la cuenta (100).
   * El motor de Prisma dimensiona su pool segun los nucleos del servidor
   * fisico, no los del contenedor, y por eso la aplicacion llego a consumir 44
   * de los 100 y cualquier tropiezo tumbaba la cuenta entera.
   */
  private getUsoDeHilos() {
    let hilos: number | null = null;
    try {
      const estado = readFileSync('/proc/self/status', 'utf8');
      const m = estado.match(/^Threads:\s*(\d+)$/m);
      if (m) hilos = Number(m[1]);
    } catch {
      // En Windows no existe /proc; en desarrollo simplemente no se informa.
    }
    const mem = process.memoryUsage();
    return {
      hilos,
      memoriaMB: Math.round(mem.rss / 1048576),
    };
  }

  /**
   * Uso de conexiones MySQL frente al limite del plan.
   *
   * En el hosting compartido el tope por usuario es bajo (20). Al superarlo,
   * Prisma falla con el error 1203 y la aplicacion deja de responder, asi que
   * conviene verlo venir antes de que ocurra.
   */
  private async getUsoDeConexiones() {
    // Filtrar por el usuario propio: en hosting compartido PROCESSLIST puede
    // devolver conexiones de todo el servidor, y compararlas contra el limite
    // personal daba una lectura falsa de saturacion.
    const procesos = await this.safeQuery<Array<{ n: unknown }>>(
      "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE USER = SUBSTRING_INDEX(CURRENT_USER(), '@', 1)",
      [],
    );
    const limites = await this.safeQuery<Array<{ n: unknown }>>(
      'SELECT @@max_user_connections AS n',
      [],
    );

    const enUso = this.toNumber(procesos?.[0]?.n);
    const limite = this.toNumber(limites?.[0]?.n);

    if (!limite) return { conexiones: null, conexionesAlLimite: false };

    const porcentaje = Math.round((enUso / limite) * 100);
    return {
      conexiones: { enUso, limite, porcentaje },
      conexionesAlLimite: porcentaje >= 75,
    };
  }
}
