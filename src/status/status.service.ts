import { Injectable } from '@nestjs/common';
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
