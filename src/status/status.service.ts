import { ForbiddenException, Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { PrismaService } from '../prisma.service';

// El renderizador de PDF vive fuera del hosting: cPanel no puede ejecutar
// Chromium porque su contenedor no consigue instanciar WebAssembly.
const PDF_RENDERER_TIMEOUT_MS = 8000;

type ServiceState = 'online' | 'degraded' | 'offline' | 'unknown';

@Injectable()
export class StatusService {
  constructor(private prisma: PrismaService) {}

  private assertAdmin(user?: { rol?: string | null }) {
    if (`${user?.rol || ''}`.toUpperCase() !== 'ADMIN') {
      throw new ForbiddenException('Solo administradores pueden ver el detalle del servidor');
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
    const [globalStatusRows, variableRows, databaseSizeRows, processRows, migrations] =
      await Promise.all([
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
    const databaseBytes = this.toNumber(databaseSizeRows?.[0]?.bytes || databaseSizeRows?.[0]?.BYTES);

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
    const [details, tableSizes, inconsistencies, drafts, migrations] = await Promise.all([
      this.getDetails(user),
      this.getTableSizes(),
      this.getInconsistencies(),
      this.getDraftSummary(),
      this.getRecentMigrations(20),
    ]);

    return {
      checkedAt,
      details,
      tableSizes,
      inconsistencies,
      drafts,
      migrations,
    };
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
        message: error instanceof Error ? error.message : 'No se pudo consultar la base de datos',
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
        status: row.rolled_back_at ? 'revertida' : row.finished_at ? 'aplicada' : 'pendiente',
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

  private async getInconsistencies() {
    const checks = await Promise.all([
      this.buildCountCheck(
        'inventario_negativo',
        'Inventario negativo',
        'Hay productos con stock menor a cero.',
        'critica',
        `SELECT COUNT(*) AS total FROM Inventario WHERE stock < 0`,
      ),
      this.buildCountCheck(
        'productos_sin_stock_max',
        'Productos sin stock maximo',
        'Hay productos sin objetivo de stock configurado.',
        'media',
        `SELECT COUNT(*) AS total FROM Producto WHERE COALESCE(stockMax, 0) <= 0`,
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
      ),
      this.buildCountCheck(
        'orden_mixta_con_saldo_negativo',
        'Ordenes mixtas con saldo negativo',
        'Hay ordenes mixtas donde los pagos o asignaciones dejaron saldo menor a cero.',
        'alta',
        `SELECT COUNT(*) AS total FROM ordenmixta WHERE COALESCE(saldoTotal, 0) < -0.05`,
      ),
    ]);

    return checks;
  }

  private async buildCountCheck(key: string, title: string, description: string, severity: string, query: string) {
    const rows = await this.safeQuery<any[]>(query, []);
    const count = this.toNumber(rows?.[0]?.total ?? rows?.[0]?.TOTAL);
    return {
      key,
      title,
      description,
      severity,
      count,
      ok: count === 0,
    };
  }

  private rowsToMap(rows: Array<Record<string, unknown>>) {
    return rows.reduce<Record<string, string>>((acc, row) => {
      const key = `${row.Variable_name ?? row.VARIABLE_NAME ?? ''}`;
      const value = row.Value ?? row.VALUE ?? row.Variable_value ?? row.VARIABLE_VALUE ?? '';
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
    const timeoutId = setTimeout(() => controller.abort(), PDF_RENDERER_TIMEOUT_MS);

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
        label: lento ? `Disponible, pero lento (${latencyMs} ms)` : 'Disponible',
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
        message: error instanceof Error ? error.message : 'Consulta no disponible',
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
