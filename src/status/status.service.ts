import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const RAILWAY_STATUS_URL = 'https://status.railway.com';

type ServiceState = 'online' | 'degraded' | 'offline' | 'unknown';

@Injectable()
export class StatusService {
  constructor(private prisma: PrismaService) {}

  async getStatus() {
    const checkedAt = new Date().toISOString();
    const [database, railway] = await Promise.all([
      this.checkDatabase(),
      this.checkRailway(),
    ]);

    const status: ServiceState =
      !database.ok ? 'degraded' : railway.state === 'degraded' ? 'degraded' : 'online';

    return {
      status,
      checkedAt,
      api: {
        ok: true,
        state: 'online' as ServiceState,
        uptimeSeconds: Math.round(process.uptime()),
        environment: process.env.NODE_ENV || 'production',
      },
      database,
      railway,
    };
  }

  async getDetails(user?: { rol?: string | null }) {
    if (`${user?.rol || ''}`.toUpperCase() !== 'ADMIN') {
      throw new ForbiddenException('Solo administradores pueden ver el detalle del servidor');
    }

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

  private async checkDatabase() {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        ok: true,
        state: 'online' as ServiceState,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        state: 'offline' as ServiceState,
        latencyMs: Date.now() - startedAt,
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

  private async getRecentMigrations() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5`,
      );
      return rows.map((row) => ({
        name: row.migration_name,
        finishedAt: row.finished_at,
      }));
    } catch {
      return [];
    }
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

  private async checkRailway() {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(RAILWAY_STATUS_URL, {
        signal: controller.signal,
        headers: {
          accept: 'text/html',
          'user-agent': 'uniforma-status-check/1.0',
        },
      });
      const html = await response.text();
      const severity = this.extractRailwaySeverity(html);
      const label = this.extractRailwayLabel(html, severity);
      const state: ServiceState = severity === 'operational' ? 'online' : 'degraded';

      return {
        ok: response.ok,
        reachable: true,
        state,
        severity,
        label,
        latencyMs: Date.now() - startedAt,
        statusPageUrl: RAILWAY_STATUS_URL,
      };
    } catch (error) {
      return {
        ok: false,
        reachable: false,
        state: 'unknown' as ServiceState,
        severity: 'unknown',
        label: 'No se pudo leer el estado publico de Railway',
        latencyMs: Date.now() - startedAt,
        statusPageUrl: RAILWAY_STATUS_URL,
        message: error instanceof Error ? error.message : 'Consulta no disponible',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private extractRailwaySeverity(html: string) {
    const severityMatch = html.match(/data-severity="([^"]+)"/i);
    const severity = severityMatch?.[1]?.toLowerCase() || 'unknown';
    if (severity === 'operational') return 'operational';
    if (severity.includes('degrad')) return 'degraded';
    if (severity.includes('outage') || severity.includes('incident')) return 'outage';
    return severity;
  }

  private extractRailwayLabel(html: string, severity: string) {
    const severityIndex = html.search(/data-severity="([^"]+)"/i);
    const statusFragment = severityIndex >= 0 ? html.slice(severityIndex, severityIndex + 1600) : html;
    const labelMatch = statusFragment.match(/<span[^>]*>([^<]*(Operational|Outage|Degraded|Incident|Maintenance)[^<]*)<\/span>/i);
    const label = labelMatch?.[1]?.replace(/\s+/g, ' ').trim();
    if (label) return label;
    if (severity === 'operational') return 'Fully Operational';
    if (severity === 'unknown') return 'Estado publico no disponible';
    return 'Railway con incidencias';
  }
}
