import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type AuthUser = {
  id?: number;
  rol?: string | null;
};

type RegistrarMensajeDto = {
  vendedorId?: number;
  numeroVendedor?: string;
  phoneNumberId?: string;
  remitente?: string;
  remitenteNombre?: string;
  mensaje?: string;
  externalId?: string;
  recibidoEn?: string;
};

type ConfigWhatsappDto = {
  whatsappBusinessNumber?: string | null;
  whatsappPhoneNumberId?: string | null;
};

type WhatsappWebhookMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
};

@Injectable()
export class WhatsappService {
  constructor(private prisma: PrismaService) {}

  private isAdmin(user?: AuthUser) {
    return `${user?.rol || ''}`.toUpperCase() === 'ADMIN';
  }

  private assertEnabled() {
    if (process.env.WHATSAPP_ENABLED !== 'true') {
      throw new ForbiddenException('La integracion de WhatsApp Business esta pendiente de activacion');
    }
  }

  private startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  verificarWebhook(mode?: string, token?: string, challenge?: string) {
    this.assertEnabled();
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || '';
    if (mode === 'subscribe' && expectedToken && token === expectedToken) {
      return challenge || '';
    }
    throw new ForbiddenException('No se pudo verificar el webhook de WhatsApp');
  }

  private getMessageText(message: WhatsappWebhookMessage) {
    if (message.text?.body) return message.text.body;
    if (message.button?.text) return message.button.text;
    if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
    if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
    return message.type ? `[${message.type}]` : null;
  }

  private getMessageDate(timestamp?: string) {
    const seconds = Number(timestamp || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
    return new Date(seconds * 1000);
  }

  private async guardarMensajeWebhook(params: {
    phoneNumberId: string;
    numeroVendedor?: string | null;
    remitente: string;
    remitenteNombre?: string | null;
    mensaje?: string | null;
    externalId?: string | null;
    recibidoEn: Date;
  }) {
    const vendedor = await this.prisma.usuario.findUnique({
      where: { whatsappPhoneNumberId: params.phoneNumberId },
      select: { id: true, whatsappBusinessNumber: true, telefono: true },
    });

    if (!vendedor) {
      return { guardado: false, motivo: 'vendedor_no_configurado' };
    }

    const data: Prisma.WhatsappMensajeCreateInput = {
      vendedor: { connect: { id: vendedor.id } },
      numeroVendedor: params.numeroVendedor || vendedor.whatsappBusinessNumber || vendedor.telefono,
      phoneNumberId: params.phoneNumberId,
      remitente: params.remitente,
      remitenteNombre: params.remitenteNombre || null,
      mensaje: params.mensaje || null,
      externalId: params.externalId || null,
      recibidoEn: params.recibidoEn,
    };

    if (params.externalId) {
      await this.prisma.whatsappMensaje.upsert({
        where: { externalId: params.externalId },
        update: {},
        create: data,
      });
    } else {
      await this.prisma.whatsappMensaje.create({ data });
    }

    return { guardado: true };
  }

  async procesarWebhook(payload: any) {
    this.assertEnabled();
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    let recibidos = 0;
    let guardados = 0;
    let sinVendedor = 0;

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        const phoneNumberId = `${value?.metadata?.phone_number_id || ''}`.trim();
        const numeroVendedor = `${value?.metadata?.display_phone_number || ''}`.trim() || null;
        const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
        const contactByWaId = new Map<string, string>();

        contacts.forEach((contact: any) => {
          const waId = `${contact?.wa_id || ''}`.trim();
          const name = `${contact?.profile?.name || ''}`.trim();
          if (waId && name) contactByWaId.set(waId, name);
        });

        const messages: WhatsappWebhookMessage[] = Array.isArray(value?.messages) ? value.messages : [];
        for (const message of messages) {
          const remitente = `${message.from || ''}`.trim();
          if (!phoneNumberId || !remitente) continue;

          recibidos += 1;
          const result = await this.guardarMensajeWebhook({
            phoneNumberId,
            numeroVendedor,
            remitente,
            remitenteNombre: contactByWaId.get(remitente) || null,
            mensaje: this.getMessageText(message),
            externalId: `${message.id || ''}`.trim() || null,
            recibidoEn: this.getMessageDate(message.timestamp),
          });

          if (result.guardado) guardados += 1;
          else sinVendedor += 1;
        }
      }
    }

    return { received: true, recibidos, guardados, sinVendedor };
  }

  async resumen(user: AuthUser) {
    this.assertEnabled();
    const usuarioWhere = this.isAdmin(user)
      ? {}
      : {
          id: Number(user?.id || 0),
        };

    const usuarios = await this.prisma.usuario.findMany({
      where: usuarioWhere,
      select: {
        id: true,
        nombre: true,
        usuario: true,
        telefono: true,
        whatsappBusinessNumber: true,
        whatsappPhoneNumberId: true,
      },
      orderBy: { nombre: 'asc' },
    });

    const today = this.startOfToday();

    const rows = await Promise.all(
      usuarios.map(async (usuario) => {
        const [totalNuevos, totalHoy, ultimoMensaje] = await Promise.all([
          this.prisma.whatsappMensaje.count({
            where: { vendedorId: usuario.id, leido: false },
          }),
          this.prisma.whatsappMensaje.count({
            where: { vendedorId: usuario.id, recibidoEn: { gte: today } },
          }),
          this.prisma.whatsappMensaje.findFirst({
            where: { vendedorId: usuario.id },
            orderBy: { recibidoEn: 'desc' },
            select: {
              id: true,
              remitente: true,
              remitenteNombre: true,
              mensaje: true,
              leido: true,
              recibidoEn: true,
            },
          }),
        ]);

        return {
          usuarioId: usuario.id,
          usuario: usuario.usuario,
          nombre: usuario.nombre,
          telefono: usuario.whatsappBusinessNumber || usuario.telefono,
          whatsappBusinessNumber: usuario.whatsappBusinessNumber,
          whatsappPhoneNumberId: usuario.whatsappPhoneNumberId,
          totalNuevos,
          totalHoy,
          ultimoMensaje,
        };
      }),
    );

    return {
      totalNuevos: rows.reduce((sum, item) => sum + item.totalNuevos, 0),
      totalHoy: rows.reduce((sum, item) => sum + item.totalHoy, 0),
      usuarios: rows,
    };
  }

  async registrarMensaje(user: AuthUser, data: RegistrarMensajeDto) {
    this.assertEnabled();
    if (!this.isAdmin(user)) {
      throw new ForbiddenException('Solo un administrador puede registrar mensajes de WhatsApp');
    }

    const vendedorId = Number(data?.vendedorId || 0);
    const numeroVendedor = `${data?.numeroVendedor || ''}`.trim();
    const remitente = `${data?.remitente || ''}`.trim();

    if (!vendedorId && !numeroVendedor) {
      throw new BadRequestException('Debes indicar vendedorId o numeroVendedor');
    }
    if (!remitente) {
      throw new BadRequestException('El remitente es obligatorio');
    }

    const phoneNumberId = `${data?.phoneNumberId || ''}`.trim();
    const vendedor = vendedorId
      ? await this.prisma.usuario.findUnique({ where: { id: vendedorId } })
      : phoneNumberId
        ? await this.prisma.usuario.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId } })
        : await this.prisma.usuario.findFirst({
            where: {
              OR: [{ whatsappBusinessNumber: numeroVendedor }, { telefono: numeroVendedor }],
            },
          });

    if (!vendedor) {
      throw new NotFoundException('No se encontro el vendedor asociado al numero de WhatsApp');
    }

    return this.prisma.whatsappMensaje.create({
      data: {
        vendedorId: vendedor.id,
        numeroVendedor: numeroVendedor || vendedor.whatsappBusinessNumber || vendedor.telefono,
        phoneNumberId: phoneNumberId || vendedor.whatsappPhoneNumberId,
        remitente,
        remitenteNombre: `${data?.remitenteNombre || ''}`.trim() || null,
        mensaje: `${data?.mensaje || ''}`.trim() || null,
        externalId: `${data?.externalId || ''}`.trim() || null,
        recibidoEn: data?.recibidoEn ? new Date(data.recibidoEn) : new Date(),
      },
    });
  }

  async listarConfiguracion(user: AuthUser) {
    this.assertEnabled();
    if (!this.isAdmin(user)) {
      throw new ForbiddenException('Solo un administrador puede configurar WhatsApp Business');
    }

    return this.prisma.usuario.findMany({
      select: {
        id: true,
        nombre: true,
        usuario: true,
        telefono: true,
        whatsappBusinessNumber: true,
        whatsappPhoneNumberId: true,
        bodega: { select: { nombre: true } },
        rol: { select: { nombre: true } },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async actualizarConfiguracion(user: AuthUser, usuarioId: number, data: ConfigWhatsappDto) {
    this.assertEnabled();
    if (!this.isAdmin(user)) {
      throw new ForbiddenException('Solo un administrador puede configurar WhatsApp Business');
    }

    const whatsappBusinessNumber = `${data?.whatsappBusinessNumber || ''}`.trim() || null;
    const whatsappPhoneNumberId = `${data?.whatsappPhoneNumberId || ''}`.trim() || null;

    return this.prisma.usuario.update({
      where: { id: Number(usuarioId) },
      data: {
        whatsappBusinessNumber,
        whatsappPhoneNumberId,
      },
      select: {
        id: true,
        nombre: true,
        usuario: true,
        telefono: true,
        whatsappBusinessNumber: true,
        whatsappPhoneNumberId: true,
        bodega: { select: { nombre: true } },
        rol: { select: { nombre: true } },
      },
    });
  }

  async marcarLeidos(user: AuthUser, vendedorId?: number) {
    this.assertEnabled();
    const targetVendedorId = this.isAdmin(user) ? Number(vendedorId || 0) || undefined : Number(user?.id || 0);

    if (!targetVendedorId) {
      throw new BadRequestException('Debes indicar el vendedor');
    }

    if (!this.isAdmin(user) && targetVendedorId !== Number(user?.id || 0)) {
      throw new ForbiddenException('No puedes modificar mensajes de otro vendedor');
    }

    return this.prisma.whatsappMensaje.updateMany({
      where: {
        vendedorId: targetVendedorId,
        leido: false,
      },
      data: { leido: true },
    });
  }
}
