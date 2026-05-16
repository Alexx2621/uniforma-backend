import { Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { Resend } from 'resend';
import { NotificacionesConfigService } from '../config/notificaciones.service';

export type MailAttachment = {
  filename: string;
  content: string | Buffer;
  contentType?: string;
  contentId?: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: NotificacionesConfigService) {}

  async sendReportEmail(
    to: string | string[],
    subject: string,
    total: number,
    fecha: string,
  ) {
    const config = await this.configService.getConfig();
    const recipients = this.normalizeRecipients(to);
    if (!recipients.length) {
      this.logger.warn(
        'No hay destinatarios configurados para el correo de reporte.',
      );
      return;
    }

    const html = `
      <h1>Reporte Diario Completo</h1>
      <p>Fecha: ${fecha}</p>
      <p>Total de ventas de todas las tiendas: Q ${total.toFixed(2)}</p>
    `;

    await this.sendMail(recipients, subject, html, config);
  }

  async sendHtmlEmail(
    to: string | string[],
    subject: string,
    html: string,
    attachments: MailAttachment[] = [],
  ) {
    const config = await this.configService.getConfig();
    const recipients = this.normalizeRecipients(to);
    if (!recipients.length) {
      this.logger.warn('No hay destinatarios configurados para el correo.');
      return;
    }

    await this.sendMail(recipients, subject, html, config, attachments);
  }

  private normalizeRecipients(value: string | string[]) {
    const raw = Array.isArray(value) ? value.join(',') : value;
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private formatFromAddress(value: string) {
    const raw = `${value || ''}`.trim() || 'noreply@uniforma.com';
    if (raw.includes('<') && raw.includes('>')) {
      return raw;
    }
    const displayName =
      process.env.MAIL_FROM_NAME || process.env.RESEND_FROM_NAME || 'Uniforma Guatemala';
    return `"${displayName.replace(/"/g, '')}" <${raw}>`;
  }

  private async sendMail(
    recipients: string[],
    subject: string,
    html: string,
    config: any,
    attachments: MailAttachment[] = [],
  ) {
    const from = this.formatFromAddress(
      config.resendFrom ||
        config.smtpFrom ||
        process.env.RESEND_FROM ||
        process.env.MAIL_FROM ||
        'noreply@uniforma.com',
    );
    const resendApiKey = config.resendApiKey || process.env.RESEND_API_KEY;
    const useResend = Boolean(
      (config.resendEnabled ||
        process.env.RESEND_ENABLED === 'true' ||
        process.env.RESEND_API_KEY) &&
      resendApiKey,
    );

    if (useResend) {
      const resend = new Resend(resendApiKey);
      const response = await resend.emails.send({
        from,
        to: recipients,
        subject,
        html,
        attachments: attachments.map((attachment) => ({
          filename: attachment.filename,
          content: Buffer.isBuffer(attachment.content)
            ? attachment.content.toString('base64')
            : attachment.content,
          content_type: attachment.contentType,
          content_id: attachment.contentId,
        })),
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      return;
    }

    const host = config.smtpHost || process.env.MAIL_HOST || 'smtp.gmail.com';
    const port = Number(config.smtpPort || process.env.MAIL_PORT || 587);
    const user = config.smtpUser || process.env.MAIL_USER;
    const pass = config.smtpPass || process.env.MAIL_PASS;

    const transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    try {
      await transporter.sendMail({
        from,
        to: recipients.join(', '),
        subject,
        html,
        attachments: attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType,
          cid: attachment.contentId,
        })),
      });
      this.logger.log(`Correo enviado a: ${recipients.join(', ')}`);
    } catch (error: any) {
      this.logger.error('Error enviando correo', error?.message || error);
      throw error;
    }
  }
}
