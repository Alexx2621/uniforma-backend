import { Injectable, NestMiddleware } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LogMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  private readonly actionRoutes = [
    /^\/auth\/login$/,
    /^\/documentos\/\d+\/pdf$/,
    /^\/inventario\/reporte\/pdf$/,
  ];

  private shouldLog(req: any) {
    const method = `${req.method || ''}`.toUpperCase();
    const path = `${req.originalUrl || req.url || ''}`.split('?')[0];

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true;
    return this.actionRoutes.some((route) => route.test(path));
  }

  private getUsuarioFromRequest(req: any) {
    const authHeader = `${req.headers?.authorization || ''}`;
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (token) {
      try {
        const payloadPart = token.split('.')[1];
        const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(
          Buffer.from(normalized, 'base64').toString('utf8'),
        );
        if (payload?.usuario) return `${payload.usuario}`;
        if (payload?.correo) return `${payload.correo}`;
      } catch {
        // El log no debe bloquear la peticion si el token no se puede leer.
      }
    }

    if (req.originalUrl === '/auth/login' && req.body?.correo) {
      return `${req.body.correo}`;
    }

    return req.user?.usuario || null;
  }

  async use(req: any, res: any, next: () => void) {
    if (!this.shouldLog(req)) {
      next();
      return;
    }

    const user = this.getUsuarioFromRequest(req);

    const log = {
      usuario: user,
      // Nunca guardar parametros de consulta: algunos cron aceptan un token
      // por query string y terminarian exponiendolo en la auditoria.
      endpoint: `${req.originalUrl || req.url || ''}`.split('?')[0],
      metodo: req.method,
      ip: req.ip,
      resultado: null,
    };

    res.on('finish', async () => {
      try {
        log.resultado = res.statusCode.toString();

        if (
          req.originalUrl === '/auth/login' &&
          res.statusCode < 400 &&
          req.body?.correo
        ) {
          const user = await this.prisma.usuario.findUnique({
            where: { correo: `${req.body.correo}` },
            select: { usuario: true },
          });
          log.usuario = user?.usuario || log.usuario;
        }

        await this.prisma.logAcceso.create({
          data: log,
        });
      } catch (err) {
        console.error('Error guardando log:', err);
      }
    });

    next();
  }
}
