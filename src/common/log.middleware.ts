import { Injectable, NestMiddleware } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LogMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: any, res: any, next: () => void) {
    const user = req.user?.usuario || null;

    const log = {
      usuario: user,
      endpoint: req.originalUrl,
      metodo: req.method,
      ip: req.ip,
      resultado: null,
    };

    res.on('finish', async () => {
      try {
        log.resultado = res.statusCode.toString();

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
