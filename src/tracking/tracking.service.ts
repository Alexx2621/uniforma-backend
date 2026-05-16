import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { MailService } from '../mail/mail.service';

interface TrackingEventOptions {
  estado: string;
  titulo: string;
  mensaje?: string | null;
  sendEmail?: boolean;
}

const TRACKING_STATES = [
  { key: 'pedido_ingresado', label: 'PEDIDO INGRESADO', icon: 'assignment-outline' },
  { key: 'en_bordado', label: 'EN BORDADO', icon: 'content-cut' },
  { key: 'pedido_recibido', label: 'PEDIDO RECIBIDO', icon: 'inventory-2-outline' },
  { key: 'en_ruta_entrega', label: 'EN RUTA DE ENTREGA', icon: 'local-shipping-outline' },
  { key: 'entregado', label: 'ENTREGADO', icon: 'task-alt' },
];

const TRACKING_TITLES = new Map(TRACKING_STATES.map((state) => [state.key, state.label]));

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  private escapeHtml(value: any) {
    return `${value ?? ''}`
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private normalizeEmail(value?: string | null) {
    const email = `${value || ''}`.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }

  private getPublicBaseUrl() {
    const raw =
      process.env.TRACKING_PUBLIC_BASE_URL ||
      process.env.PUBLIC_BACKEND_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      process.env.API_PUBLIC_URL ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
    return raw.replace(/\/+$/, '');
  }

  private getTrackingLogoUrl() {
    const configured = `${process.env.TRACKING_LOGO_URL || process.env.EMAIL_LOGO_URL || ''}`.trim();
    if (configured) return configured;
    const baseUrl = this.getPublicBaseUrl();
    return baseUrl ? `${baseUrl}/assets/uniforma-logo-round.png` : '';
  }

  private canManageTracking(user?: { rol?: string | null; permisos?: string[] | null }) {
    if (`${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN') return true;
    return Array.isArray(user?.permisos) && user.permisos.includes('tracking.manage');
  }

  private async generateToken() {
    for (let i = 0; i < 5; i += 1) {
      const token = randomBytes(24).toString('hex');
      const exists = await this.prisma.pedidoTracking.findUnique({ where: { token } });
      if (!exists) return token;
    }
    return `${Date.now()}${randomBytes(12).toString('hex')}`;
  }

  private async resolvePedido(pedidoId: number) {
    return this.prisma.pedidoProduccion.findUnique({
      where: { id: Number(pedidoId) },
      include: {
        cliente: true,
        bodega: true,
        usuario: { select: { id: true, nombre: true, usuario: true } },
        detalle: { include: { producto: true } },
      },
    });
  }

  private getPedidoCorreo(pedido: any) {
    return this.normalizeEmail(pedido?.clienteCorreo || pedido?.cliente?.correo);
  }

  private pedidoTieneBordado(pedido: any) {
    return Array.isArray(pedido?.detalle) && pedido.detalle.some((item: any) => (
      Number(item?.bordado || 0) > 0
      || Boolean(item?.bordadoColor)
      || Boolean(item?.bordadoTamano)
      || Boolean(item?.bordadoPosicion)
      || Boolean(item?.bordadoObservaciones)
      || Boolean(item?.bordadoImagenUrl)
    ));
  }

  private getTrackingFlow(hasBordado: boolean) {
    return TRACKING_STATES.filter((state) => hasBordado || state.key !== 'en_bordado');
  }

  private getFlowState(estado?: string | null, hasBordado = false): string {
    const flow = this.getTrackingFlow(hasBordado);
    return flow.find((state) => state.key === estado) ? `${estado}` : 'pedido_ingresado';
  }

  private getTimelineIconHtml(state: { icon: string }, isDone: boolean) {
    const opacity = isDone ? '1' : '.42';
    const color = isDone ? 'white' : '%2394a3b8';
    return `<img src="https://api.iconify.design/material-symbols:${state.icon}.svg?color=${color}&width=64&height=64" width="24" height="24" alt="" style="display:block;margin:8px auto 0;opacity:${opacity};border:0;-ms-interpolation-mode:bicubic;" />`;
  }

  private buildProgressHtml(pedido: any, estado: string) {
    const flow = this.getTrackingFlow(this.pedidoTieneBordado(pedido));
    const currentIndex = Math.max(0, flow.findIndex((state) => state.key === estado));
    const trackCells = flow.map((state, index) => {
      const isDone = index <= currentIndex;
      const isCurrent = index === currentIndex;
      const circleBg = isDone ? '#0f2f6f' : '#e5e7eb';
      const circleBorder = isCurrent ? '#ef4444' : (isDone ? '#1f6feb' : '#cbd5e1');
      const connectorColor = index < currentIndex ? '#1f6feb' : '#d7deea';
      const circleColor = isDone ? '#ffffff' : '#94a3b8';
      return `
        <td style="width:34px;text-align:center;vertical-align:middle;">
          <div style="width:42px;height:42px;border-radius:50%;background:${circleBg};border:3px solid ${circleBorder};color:${circleColor};text-align:center;margin:0 auto;box-shadow:${isCurrent ? '0 6px 14px rgba(15,47,111,.22)' : 'none'};">${this.getTimelineIconHtml(state, isDone)}</div>
        </td>
        ${index < flow.length - 1 ? `<td style="vertical-align:middle;"><div style="height:4px;background:${connectorColor};border-radius:999px;line-height:4px;font-size:1px;">&nbsp;</div></td>` : ''}
      `;
    }).join('');
    const labelCells = flow.map((state, index) => {
      const isDone = index <= currentIndex;
      return `
        <td style="width:${100 / flow.length}%;text-align:center;vertical-align:top;padding:12px 4px 0;">
          <div style="font-size:11px;font-weight:800;line-height:1.25;color:${isDone ? '#0f172a' : '#64748b'};text-transform:uppercase;">${this.escapeHtml(state.label)}</div>
        </td>
      `;
    }).join('');

    return `
      <div style="background:#f8fbff;border:1px solid #dbe2ea;border-radius:16px;padding:28px 18px 26px;margin:22px 0 24px;box-shadow:0 10px 24px rgba(15,23,42,.06);">
        <table role="presentation" style="width:100%;border-collapse:collapse;">
          <tr>${trackCells}</tr>
        </table>
        <table role="presentation" style="width:100%;border-collapse:collapse;">
          <tr>${labelCells}</tr>
        </table>
      </div>
    `;
  }

  private async sendTrackingEmail(tracking: any, event: TrackingEventOptions) {
    const email = this.normalizeEmail(tracking?.clienteCorreo);
    if (!email) return false;

    const pedido = tracking.pedido;
    const folio = pedido?.folio || `P-${pedido?.id}`;
    const cliente = pedido?.clienteNombre || pedido?.cliente?.nombre || 'Cliente';
    const flowEstado = this.getFlowState(event.estado, this.pedidoTieneBordado(pedido));
    const estadoLabel = TRACKING_TITLES.get(flowEstado) || event.titulo;
    const logoUrl = this.getTrackingLogoUrl();
    const logoHtml = logoUrl
      ? `<img src="${this.escapeHtml(logoUrl)}" width="76" height="76" alt="" style="display:block;width:76px;height:76px;object-fit:contain;border:0;margin:0 0 0 auto;" />`
      : '';
    const html = `
      <div style="margin:0;background:#f3f6fb;padding:34px 12px;font-family:Arial,sans-serif;color:#111827;">
        <div style="max-width:780px;margin:0 auto;background:#ffffff;border:1px solid #dbe2ea;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.12);">
          <div style="background:#0f2f6f;color:#ffffff;padding:26px 30px;">
            <table role="presentation" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="vertical-align:middle;">
                  <p style="margin:0 0 6px;color:#bfdbfe;font-size:12px;font-weight:700;text-transform:uppercase;">Uniforma Guatemala</p>
                  <h1 style="margin:0;font-size:24px;line-height:1.3;">Tracking de pedido ${this.escapeHtml(folio)}</h1>
                </td>
                <td style="vertical-align:middle;text-align:right;width:96px;">
                  ${logoHtml}
                  <p style="margin:8px 0 0;font-size:12px;color:#dbeafe;font-weight:800;text-transform:uppercase;">${this.escapeHtml(estadoLabel)}</p>
                </td>
              </tr>
            </table>
          </div>
          <div style="padding:30px;">
            <p style="margin:0 0 14px;font-size:15px;">Hola <strong>${this.escapeHtml(cliente)}</strong>,</p>
            <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">${this.escapeHtml(event.mensaje || event.titulo)}</p>
            ${this.buildProgressHtml(pedido, flowEstado)}
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:22px;">
              <p style="margin:0;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;">Estado actual</p>
              <p style="margin:6px 0 0;color:#102a63;font-size:18px;font-weight:800;">${this.escapeHtml(estadoLabel)}</p>
            </div>
            <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
              <tr>
                <td style="padding:10px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;">Pedido</td>
                <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${this.escapeHtml(folio)}</td>
              </tr>
              <tr>
                <td style="padding:10px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;">Cliente</td>
                <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${this.escapeHtml(cliente)}</td>
              </tr>
              <tr>
                <td style="padding:10px;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;">Tienda</td>
                <td style="padding:10px;text-align:right;font-weight:700;">${this.escapeHtml(pedido?.bodega?.nombre || 'N/D')}</td>
              </tr>
            </table>
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">Recibiras un nuevo correo automaticamente cada vez que tu pedido tenga una actualizacion importante.</p>
          </div>
        </div>
      </div>
    `;

    const subjectTimestamp = new Date().toLocaleString('es-GT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    await this.mailService.sendHtmlEmail(
      email,
      `${event.titulo} - Pedido ${folio} - ${subjectTimestamp}`,
      html,
    );
    return true;
  }

  async ensureTrackingForPedido(pedidoId: number, event: TrackingEventOptions) {
    const pedido = await this.resolvePedido(pedidoId);
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const email = this.getPedidoCorreo(pedido);
    let tracking = await this.prisma.pedidoTracking.findUnique({
      where: { pedidoId: pedido.id },
      include: { pedido: { include: { cliente: true, bodega: true, detalle: true } } },
    });

    if (!tracking) {
      tracking = await this.prisma.pedidoTracking.create({
        data: {
          pedidoId: pedido.id,
          token: await this.generateToken(),
          clienteCorreo: email,
          ultimoEstado: event.estado,
        },
        include: { pedido: { include: { cliente: true, bodega: true, detalle: true } } },
      });
    } else if (email && email !== tracking.clienteCorreo) {
      tracking = await this.prisma.pedidoTracking.update({
        where: { id: tracking.id },
        data: { clienteCorreo: email },
        include: { pedido: { include: { cliente: true, bodega: true, detalle: true } } },
      });
    }

    let emailEnviado = false;
    if (event.sendEmail) {
      try {
        emailEnviado = await this.sendTrackingEmail(tracking, event);
      } catch (error: any) {
        this.logger.error(`No se pudo enviar tracking del pedido ${pedido.id}: ${error?.message || error}`);
      }
    }

    const evento = await this.prisma.pedidoTrackingEvento.create({
      data: {
        trackingId: tracking.id,
        estado: event.estado,
        titulo: event.titulo,
        mensaje: event.mensaje || null,
        emailEnviado,
      },
    });

    return this.prisma.pedidoTracking.update({
      where: { id: tracking.id },
      data: {
        ultimoEstado: event.estado,
        ultimoEnvioEn: emailEnviado ? new Date() : tracking.ultimoEnvioEn,
      },
      include: {
        pedido: { include: { cliente: true, bodega: true, detalle: true, usuario: { select: { id: true, nombre: true, usuario: true } } } },
        eventos: { orderBy: { creadoEn: 'asc' } },
      },
    }).then((updated) => ({ ...updated, evento }));
  }

  private parseLocalDate(value?: string | null, endOfDay = false) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}-06:00`);
  }

  async listarPedidosTracking(
    user?: { id?: number; rol?: string | null; rolId?: number | null },
    filters: { usuarioId?: string; fechaInicio?: string; fechaFin?: string } = {},
  ) {
    const isAdmin = `${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN';
    const where: any = {};
    const fechaInicio = this.parseLocalDate(filters.fechaInicio);
    const fechaFin = this.parseLocalDate(filters.fechaFin, true);
    if (fechaInicio || fechaFin) {
      where.fecha = {
        ...(fechaInicio ? { gte: fechaInicio } : {}),
        ...(fechaFin ? { lte: fechaFin } : {}),
      };
    }
    if (isAdmin) {
      const usuarioId = Number(filters.usuarioId || 0);
      if (usuarioId > 0) where.usuarioId = usuarioId;
    } else if (Number(user?.id || 0) > 0) {
      where.usuarioId = Number(user?.id);
    }

    const pedidos = await this.prisma.pedidoProduccion.findMany({
      where,
      include: {
        cliente: true,
        bodega: true,
        usuario: { select: { id: true, nombre: true, usuario: true } },
        detalle: true,
        tracking: { include: { eventos: { orderBy: { creadoEn: 'desc' }, take: 1 } } },
      },
      orderBy: { fecha: 'desc' },
      take: 300,
    });

    return pedidos.map((pedido: any) => {
      const hasBordado = this.pedidoTieneBordado(pedido);
      const flow = this.getTrackingFlow(hasBordado);
      return {
      id: pedido.id,
      folio: pedido.folio || `P-${pedido.id}`,
      fecha: pedido.fecha,
      estado: pedido.estado,
      clienteNombre: pedido.clienteNombre || pedido.cliente?.nombre || 'Mostrador',
      clienteCorreo: pedido.clienteCorreo || pedido.cliente?.correo || null,
      bodega: pedido.bodega?.nombre || null,
      usuario: pedido.usuario?.nombre || pedido.solicitadoPor || pedido.usuario?.usuario || null,
      tieneBordado: hasBordado,
      estadosTracking: flow,
      tracking: pedido.tracking
        ? {
            token: pedido.tracking.token,
            ultimoEstado: this.getFlowState(pedido.tracking.ultimoEstado, hasBordado),
            ultimoEnvioEn: pedido.tracking.ultimoEnvioEn,
            ultimoEvento: pedido.tracking.eventos?.[0] || null,
          }
        : null,
      };
    });
  }

  async reenviarTracking(pedidoId: number, user?: { rol?: string | null; permisos?: string[] | null }) {
    if (!this.canManageTracking(user)) {
      throw new ForbiddenException('No tienes permiso para reenviar tracking');
    }

    const tracking = await this.prisma.pedidoTracking.findUnique({
      where: { pedidoId: Number(pedidoId) },
      include: { pedido: { include: { detalle: true } } },
    });
    const estadoActual = this.getFlowState(
      tracking?.ultimoEstado || 'pedido_ingresado',
      this.pedidoTieneBordado(tracking?.pedido),
    );
    const tituloActual = TRACKING_TITLES.get(estadoActual) || 'PEDIDO INGRESADO';

    return this.ensureTrackingForPedido(Number(pedidoId), {
      estado: estadoActual,
      titulo: tituloActual,
      mensaje: `Te reenviamos el estado actual de tu pedido: ${tituloActual}.`,
      sendEmail: true,
    });
  }

  async actualizarEstadoTracking(
    pedidoId: number,
    data: { estado?: string; mensaje?: string | null },
    user?: { rol?: string | null; permisos?: string[] | null },
  ) {
    if (!this.canManageTracking(user)) {
      throw new ForbiddenException('No tienes permiso para actualizar tracking');
    }

    const pedido = await this.resolvePedido(Number(pedidoId));
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const flow = this.getTrackingFlow(this.pedidoTieneBordado(pedido));
    const estado = `${data?.estado || ''}`.trim();
    const selected = flow.find((state) => state.key === estado);
    if (!selected) {
      throw new ForbiddenException('El estado seleccionado no aplica para este pedido');
    }

    return this.ensureTrackingForPedido(Number(pedidoId), {
      estado: selected.key,
      titulo: selected.label,
      mensaje: data?.mensaje || `Tu pedido ahora esta en estado: ${selected.label}.`,
      sendEmail: true,
    });
  }
}
