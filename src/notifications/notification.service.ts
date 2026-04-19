import { PrismaService } from '../prisma.service';

export class NotificationService {
  constructor(private prisma: PrismaService) {}

  private async getSettings() {
    const cfg = await this.prisma.notificacionConfig.findUnique({ where: { id: 1 } });
    return {
      stockThreshold: Number(cfg?.stockThreshold ?? process.env.STOCK_ALERT_THRESHOLD ?? 5),
      highSaleThreshold: Number(cfg?.highSaleThreshold ?? process.env.HIGH_SALE_THRESHOLD ?? 1000),
      emailTo: cfg?.emailTo || process.env.NOTIF_EMAIL_TO || '',
      whatsappTo: cfg?.whatsappTo || process.env.NOTIF_WHATSAPP_TO || '',
    };
  }

  async notifyLowStock(items: { bodegaId: number; productoId: number }[]) {
    if (!items.length) return;
    const cfg = await this.getSettings();
    const details = await Promise.all(
      items.map(async (i) => {
        const inv = await this.prisma.inventario.findUnique({
          where: { bodegaId_productoId: { bodegaId: i.bodegaId, productoId: i.productoId } },
          include: { bodega: true, producto: true },
        });
        return inv
          ? `Bodega ${inv.bodega.nombre} - ${inv.producto.codigo} (${inv.producto.nombre}) stock ${inv.stock}`
          : null;
      }),
    );
    const lines = details.filter((v): v is string => Boolean(v));
    if (!lines.length) return;
    this.logNotification('Stock bajo', lines, cfg);
  }

  async notifyHighSale(total: number, folio: string) {
    const cfg = await this.getSettings();
    if (total >= cfg.highSaleThreshold) {
      this.logNotification('Venta alta', [`Folio ${folio} por Q ${total.toFixed(2)}`], cfg);
    }
  }

  async notifyError(context: string, message: string) {
    const cfg = await this.getSettings();
    this.logNotification('Error', [`${context}: ${message}`], cfg);
  }

  private logNotification(
    title: string,
    lines: string[],
    cfg: { emailTo: string; whatsappTo: string },
  ) {
    const target = [cfg.emailTo && `Email: ${cfg.emailTo}`, cfg.whatsappTo && `WhatsApp: ${cfg.whatsappTo}`]
      .filter(Boolean)
      .join(' | ');
    if (!target) {
      // Si no hay destinatarios configurados, evitar ruido en logs
      return;
    }
    console.log(`[NOTIF] ${title} -> ${target}`);
    lines.forEach((l) => console.log(` - ${l}`));
  }
}
