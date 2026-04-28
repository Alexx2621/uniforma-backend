import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  DEFAULT_PRODUCTOS_MASS_CONFIG,
  ProductosMassConfig,
} from '../productos/productos-mass-config';

type ReporteConfigItem = {
  tipo: string;
  enabled: boolean;
  emailTo: string;
  subject: string;
  triggerOn: string[];
};

type ModuleConfigState = {
  disabledPaths: string[];
  productionInternalMode: boolean;
  userDisabledPaths: Record<string, string[]>;
  productMassConfig: ProductosMassConfig;
  pedidoAlertRoleIds: number[];
  crossStoreRoleIds: number[];
  unifyOrderRoleIds: number[];
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  resendEnabled: boolean;
  resendApiKey: string;
  resendFrom: string;
  resendTemplateId: string;
  reportesConfig: { reportes: ReporteConfigItem[] };
};

@Injectable()
export class NotificacionesConfigService {
  constructor(private prisma: PrismaService) {}

  private readonly moduleConfigPath = join(
    process.cwd(),
    'storage',
    'system-config.json',
  );

  private getEnvResendEnabled() {
    const value = process.env.RESEND_ENABLED;
    if (value !== undefined) {
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    }
    return Boolean(process.env.RESEND_API_KEY);
  }

  private getDefaultModuleConfig(): ModuleConfigState {
    return {
      disabledPaths: [],
      productionInternalMode: false,
      userDisabledPaths: {},
      productMassConfig: DEFAULT_PRODUCTOS_MASS_CONFIG,
      pedidoAlertRoleIds: [],
      crossStoreRoleIds: [],
      unifyOrderRoleIds: [],
      smtpHost: process.env.MAIL_HOST || 'smtp.gmail.com',
      smtpPort: Number(process.env.MAIL_PORT) || 587,
      smtpUser: process.env.MAIL_USER || '',
      smtpPass: process.env.MAIL_PASS || '',
      smtpFrom: process.env.MAIL_FROM || 'noreply@uniforma.com',
      resendEnabled: this.getEnvResendEnabled(),
      resendApiKey: process.env.RESEND_API_KEY || '',
      resendFrom:
        process.env.RESEND_FROM ||
        process.env.MAIL_FROM ||
        'noreply@uniforma.com',
      resendTemplateId: process.env.RESEND_TEMPLATE_ID || '',
      reportesConfig: {
        reportes: [
          {
            tipo: 'reporteDiario',
            enabled: false,
            emailTo: process.env.REPORT_EMAIL_TO || '',
            subject: 'Reporte diario {fecha}',
            triggerOn: ['create'],
          },
        ],
      },
    };
  }

  private async ensureConfig() {
    const existing = await this.prisma.notificacionConfig.findUnique({
      where: { id: 1 },
    });
    const config =
      existing ||
      (await this.prisma.notificacionConfig.create({
        data: {
          id: 1,
          emailTo: '',
          whatsappTo: '',
          stockThreshold: 5,
          highSaleThreshold: 1000,
          smtpHost: process.env.MAIL_HOST || 'smtp.gmail.com',
          smtpPort: Number(process.env.MAIL_PORT) || 587,
          smtpUser: process.env.MAIL_USER || '',
          smtpPass: process.env.MAIL_PASS || '',
          smtpFrom: process.env.MAIL_FROM || 'noreply@uniforma.com',
          resendEnabled: this.getEnvResendEnabled(),
          resendApiKey: process.env.RESEND_API_KEY || '',
          resendFrom:
            process.env.RESEND_FROM ||
            process.env.MAIL_FROM ||
            'noreply@uniforma.com',
          resendTemplateId: process.env.RESEND_TEMPLATE_ID || '',
          reportesConfig: {
            reportes: [
              {
                tipo: 'reporteDiario',
                enabled: false,
                emailTo: process.env.REPORT_EMAIL_TO || '',
                subject: 'Reporte diario {fecha}',
                triggerOn: ['create'],
              },
            ],
          },
        },
      }));

    const hasHydratedModuleConfig =
      config.disabledPaths !== null ||
      config.userDisabledPaths !== null ||
      config.productMassConfig !== null ||
      config.pedidoAlertRoleIds !== null ||
      config.crossStoreRoleIds !== null ||
      config.unifyOrderRoleIds !== null ||
      config.smtpHost !== null ||
      config.smtpPort !== null ||
      config.smtpFrom !== null ||
      config.resendEnabled !== null ||
      config.resendFrom !== null ||
      config.resendTemplateId !== null ||
      config.reportesConfig !== null;

    if (hasHydratedModuleConfig) {
      return config;
    }

    const legacy = await this.readLegacyModuleConfig();
    return this.prisma.notificacionConfig.update({
      where: { id: 1 },
      data: {
        disabledPaths: legacy.disabledPaths,
        productionInternalMode: legacy.productionInternalMode,
        userDisabledPaths: legacy.userDisabledPaths,
        productMassConfig:
          legacy.productMassConfig as unknown as Prisma.InputJsonValue,
        pedidoAlertRoleIds: legacy.pedidoAlertRoleIds,
        crossStoreRoleIds: legacy.crossStoreRoleIds,
        unifyOrderRoleIds: legacy.unifyOrderRoleIds,
      },
    });
  }

  private async readLegacyModuleConfig(): Promise<ModuleConfigState> {
    try {
      const raw = await readFile(this.moduleConfigPath, 'utf8');
      const parsed = JSON.parse(raw);
      const legacyModulesRestricted = Boolean(parsed?.modulesRestricted);
      const disabledPaths = Array.isArray(parsed?.disabledPaths)
        ? parsed.disabledPaths.filter(
            (path: unknown): path is string => typeof path === 'string',
          )
        : legacyModulesRestricted
          ? [
              '/ventas',
              '/inventario',
              '/inventario/resumen',
              '/inventario/traslados',
              '/reportes/ventas-diarias',
              '/reportes/ventas-producto',
              '/reportes/top-clientes',
              '/reportes/ingresos',
              '/reportes/traslados',
              '/reportes/stock-bajo',
            ]
          : [];

      return {
        disabledPaths,
        productionInternalMode: Boolean(parsed?.productionInternalMode),
        userDisabledPaths: this.normalizeUserDisabledPaths(
          parsed?.userDisabledPaths,
        ),
        productMassConfig: this.normalizeProductMassConfig(
          parsed?.productMassConfig,
        ),
        pedidoAlertRoleIds: this.normalizeRoleIds(parsed?.pedidoAlertRoleIds),
        crossStoreRoleIds: this.normalizeRoleIds(parsed?.crossStoreRoleIds),
        unifyOrderRoleIds: this.normalizeRoleIds(parsed?.unifyOrderRoleIds),
        smtpHost: process.env.MAIL_HOST || 'smtp.gmail.com',
        smtpPort: Number(process.env.MAIL_PORT) || 587,
        smtpUser: process.env.MAIL_USER || '',
        smtpPass: process.env.MAIL_PASS || '',
        smtpFrom: process.env.MAIL_FROM || 'noreply@uniforma.com',
        resendEnabled: false,
        resendApiKey: '',
        resendFrom: process.env.MAIL_FROM || 'noreply@uniforma.com',
        resendTemplateId: '',
        reportesConfig: {
          reportes: [
            {
              tipo: 'reporteDiario',
              enabled: false,
              emailTo: process.env.REPORT_EMAIL_TO || '',
              subject: 'Reporte diario {fecha}',
              triggerOn: ['create'],
            },
          ],
        },
      };
    } catch {
      return this.getDefaultModuleConfig();
    }
  }

  private extractModuleConfig(config: {
    disabledPaths: unknown;
    productionInternalMode: boolean;
    userDisabledPaths: unknown;
    productMassConfig: unknown;
    pedidoAlertRoleIds: unknown;
    crossStoreRoleIds: unknown;
    unifyOrderRoleIds: unknown;
    smtpHost: unknown;
    smtpPort: unknown;
    smtpUser: unknown;
    smtpPass: unknown;
    smtpFrom: unknown;
    resendEnabled?: unknown;
    resendApiKey?: unknown;
    resendFrom?: unknown;
    resendTemplateId?: unknown;
    reportesConfig: unknown;
  }): ModuleConfigState {
    const envResendEnabled = this.getEnvResendEnabled();
    const resendApiKey =
      typeof config.resendApiKey === 'string' && config.resendApiKey
        ? config.resendApiKey
        : process.env.RESEND_API_KEY || '';

    return {
      disabledPaths: Array.isArray(config.disabledPaths)
        ? config.disabledPaths.filter(
            (path): path is string => typeof path === 'string',
          )
        : [],
      productionInternalMode: Boolean(config.productionInternalMode),
      userDisabledPaths: this.normalizeUserDisabledPaths(
        config.userDisabledPaths,
      ),
      productMassConfig: this.normalizeProductMassConfig(
        config.productMassConfig,
      ),
      pedidoAlertRoleIds: this.normalizeRoleIds(config.pedidoAlertRoleIds),
      crossStoreRoleIds: this.normalizeRoleIds(config.crossStoreRoleIds),
      unifyOrderRoleIds: this.normalizeRoleIds(config.unifyOrderRoleIds),
      smtpHost:
        typeof config.smtpHost === 'string'
          ? config.smtpHost
          : process.env.MAIL_HOST || 'smtp.gmail.com',
      smtpPort:
        typeof config.smtpPort === 'number'
          ? config.smtpPort
          : Number(process.env.MAIL_PORT) || 587,
      smtpUser:
        typeof config.smtpUser === 'string'
          ? config.smtpUser
          : process.env.MAIL_USER || '',
      smtpPass:
        typeof config.smtpPass === 'string'
          ? config.smtpPass
          : process.env.MAIL_PASS || '',
      smtpFrom:
        typeof config.smtpFrom === 'string'
          ? config.smtpFrom
          : process.env.MAIL_FROM || 'noreply@uniforma.com',
      resendEnabled:
        (typeof config.resendEnabled === 'boolean'
          ? config.resendEnabled
          : false) || envResendEnabled,
      resendApiKey,
      resendFrom:
        typeof config.resendFrom === 'string' && config.resendFrom
          ? config.resendFrom
          : process.env.RESEND_FROM ||
            process.env.MAIL_FROM ||
            'noreply@uniforma.com',
      resendTemplateId:
        typeof config.resendTemplateId === 'string' && config.resendTemplateId
          ? config.resendTemplateId
          : process.env.RESEND_TEMPLATE_ID || '',
      reportesConfig:
        typeof config.reportesConfig === 'object' &&
        config.reportesConfig !== null
          ? (config.reportesConfig as { reportes: ReporteConfigItem[] })
          : {
              reportes: [
                {
                  tipo: 'reporteDiario',
                  enabled: false,
                  emailTo: process.env.REPORT_EMAIL_TO || '',
                  subject: 'Reporte diario {fecha}',
                  triggerOn: ['create'],
                },
              ],
            },
    };
  }

  async getConfig() {
    const config = await this.ensureConfig();
    const moduleConfig = this.extractModuleConfig(config);
    return {
      ...config,
      disabledPaths: moduleConfig.disabledPaths,
      productionInternalMode: moduleConfig.productionInternalMode,
      userDisabledPaths: moduleConfig.userDisabledPaths,
      productMassConfig: moduleConfig.productMassConfig,
      pedidoAlertRoleIds: moduleConfig.pedidoAlertRoleIds,
      crossStoreRoleIds: moduleConfig.crossStoreRoleIds,
      unifyOrderRoleIds: moduleConfig.unifyOrderRoleIds,
      smtpHost: moduleConfig.smtpHost,
      smtpPort: moduleConfig.smtpPort,
      smtpUser: moduleConfig.smtpUser,
      smtpPass: moduleConfig.smtpPass,
      smtpFrom: moduleConfig.smtpFrom,
      resendEnabled: moduleConfig.resendEnabled,
      resendApiKey: moduleConfig.resendApiKey,
      resendFrom: moduleConfig.resendFrom,
      resendTemplateId: moduleConfig.resendTemplateId,
      reportesConfig: moduleConfig.reportesConfig,
    };
  }

  async updateConfig(data: {
    emailTo?: string;
    whatsappTo?: string;
    stockThreshold?: number;
    highSaleThreshold?: number;
    disabledPaths?: string[];
    productionInternalMode?: boolean;
    userDisabledPaths?: Record<string, string[]>;
    productMassConfig?: ProductosMassConfig;
    pedidoAlertRoleIds?: number[];
    crossStoreRoleIds?: number[];
    unifyOrderRoleIds?: number[];
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    smtpFrom?: string;
    resendEnabled?: boolean;
    resendApiKey?: string;
    resendFrom?: string;
    resendTemplateId?: string;
    reportesConfig?: { reportes: ReporteConfigItem[] };
  }) {
    const existing = await this.ensureConfig();
    const moduleConfig = this.extractModuleConfig(existing);

    const config = await this.prisma.notificacionConfig.update({
      where: { id: 1 },
      data: {
        emailTo: data.emailTo ?? existing.emailTo ?? '',
        whatsappTo: data.whatsappTo ?? existing.whatsappTo ?? '',
        stockThreshold: data.stockThreshold ?? existing.stockThreshold ?? 5,
        highSaleThreshold:
          data.highSaleThreshold ?? existing.highSaleThreshold ?? 1000,
        smtpHost:
          data.smtpHost ??
          existing.smtpHost ??
          (process.env.MAIL_HOST || 'smtp.gmail.com'),
        smtpPort:
          data.smtpPort ??
          existing.smtpPort ??
          (Number(process.env.MAIL_PORT) || 587),
        smtpUser:
          data.smtpUser ?? existing.smtpUser ?? (process.env.MAIL_USER || ''),
        smtpPass:
          data.smtpPass ?? existing.smtpPass ?? (process.env.MAIL_PASS || ''),
        smtpFrom:
          data.smtpFrom ??
          existing.smtpFrom ??
          (process.env.MAIL_FROM || 'noreply@uniforma.com'),
        resendEnabled:
          data.resendEnabled ??
          existing.resendEnabled ??
          this.getEnvResendEnabled(),
        resendApiKey:
          data.resendApiKey ??
          existing.resendApiKey ??
          (process.env.RESEND_API_KEY || ''),
        resendFrom:
          data.resendFrom ??
          existing.resendFrom ??
          (process.env.RESEND_FROM ||
            process.env.MAIL_FROM ||
            'noreply@uniforma.com'),
        resendTemplateId:
          data.resendTemplateId ??
          existing.resendTemplateId ??
          (process.env.RESEND_TEMPLATE_ID || ''),
        reportesConfig:
          data.reportesConfig === undefined
            ? (existing.reportesConfig as Prisma.InputJsonValue) ||
              Prisma.JsonNull
            : (data.reportesConfig as unknown as Prisma.InputJsonValue),
        disabledPaths: Array.isArray(data.disabledPaths)
          ? data.disabledPaths.filter((path) => typeof path === 'string')
          : moduleConfig.disabledPaths,
        productionInternalMode:
          typeof data.productionInternalMode === 'boolean'
            ? data.productionInternalMode
            : moduleConfig.productionInternalMode,
        userDisabledPaths:
          data.userDisabledPaths === undefined
            ? moduleConfig.userDisabledPaths
            : this.normalizeUserDisabledPaths(data.userDisabledPaths),
        productMassConfig:
          data.productMassConfig === undefined
            ? (moduleConfig.productMassConfig as unknown as Prisma.InputJsonValue)
            : (this.normalizeProductMassConfig(
                data.productMassConfig,
              ) as unknown as Prisma.InputJsonValue),
        pedidoAlertRoleIds:
          data.pedidoAlertRoleIds === undefined
            ? moduleConfig.pedidoAlertRoleIds
            : this.normalizeRoleIds(data.pedidoAlertRoleIds),
        crossStoreRoleIds:
          data.crossStoreRoleIds === undefined
            ? moduleConfig.crossStoreRoleIds
            : this.normalizeRoleIds(data.crossStoreRoleIds),
        unifyOrderRoleIds:
          data.unifyOrderRoleIds === undefined
            ? moduleConfig.unifyOrderRoleIds
            : this.normalizeRoleIds(data.unifyOrderRoleIds),
      },
    });

    const nextModuleConfig = this.extractModuleConfig(config);
    return {
      ...config,
      disabledPaths: nextModuleConfig.disabledPaths,
      productionInternalMode: nextModuleConfig.productionInternalMode,
      userDisabledPaths: nextModuleConfig.userDisabledPaths,
      productMassConfig: nextModuleConfig.productMassConfig,
      pedidoAlertRoleIds: nextModuleConfig.pedidoAlertRoleIds,
      crossStoreRoleIds: nextModuleConfig.crossStoreRoleIds,
      unifyOrderRoleIds: nextModuleConfig.unifyOrderRoleIds,
      smtpHost: nextModuleConfig.smtpHost,
      smtpPort: nextModuleConfig.smtpPort,
      smtpUser: nextModuleConfig.smtpUser,
      smtpPass: nextModuleConfig.smtpPass,
      smtpFrom: nextModuleConfig.smtpFrom,
      resendEnabled: nextModuleConfig.resendEnabled,
      resendApiKey: nextModuleConfig.resendApiKey,
      resendFrom: nextModuleConfig.resendFrom,
      resendTemplateId: nextModuleConfig.resendTemplateId,
      reportesConfig: nextModuleConfig.reportesConfig,
    };
  }

  private normalizeUserDisabledPaths(raw: unknown): Record<string, string[]> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(raw)
        .filter(
          ([key, value]) => typeof key === 'string' && Array.isArray(value),
        )
        .map(([key, value]) => [
          key.trim().toUpperCase(),
          value.filter((path): path is string => typeof path === 'string'),
        ]),
    );
  }

  private normalizeProductMassConfig(raw: unknown): ProductosMassConfig {
    if (!raw || typeof raw !== 'object') {
      return DEFAULT_PRODUCTOS_MASS_CONFIG;
    }

    const parsed = raw as Partial<ProductosMassConfig>;
    return {
      precio:
        typeof parsed.precio === 'number' && Number.isFinite(parsed.precio)
          ? parsed.precio
          : DEFAULT_PRODUCTOS_MASS_CONFIG.precio,
      stockMax:
        typeof parsed.stockMax === 'number' && Number.isFinite(parsed.stockMax)
          ? parsed.stockMax
          : DEFAULT_PRODUCTOS_MASS_CONFIG.stockMax,
      mermaPorcentaje:
        typeof parsed.mermaPorcentaje === 'number' &&
        Number.isFinite(parsed.mermaPorcentaje)
          ? parsed.mermaPorcentaje
          : DEFAULT_PRODUCTOS_MASS_CONFIG.mermaPorcentaje,
      generos:
        Array.isArray(parsed.generos) && parsed.generos.length
          ? parsed.generos
              .filter(
                (item): item is { nombre: string; abreviacion: string } =>
                  typeof item?.nombre === 'string' &&
                  typeof item?.abreviacion === 'string',
              )
              .map((item) => ({
                nombre: item.nombre.trim(),
                abreviacion: item.abreviacion.trim(),
              }))
          : DEFAULT_PRODUCTOS_MASS_CONFIG.generos,
      telas:
        Array.isArray(parsed.telas) && parsed.telas.length
          ? parsed.telas
              .filter(
                (item): item is { nombre: string; abreviacion: string } =>
                  typeof item?.nombre === 'string' &&
                  typeof item?.abreviacion === 'string',
              )
              .map((item) => ({
                nombre: item.nombre.trim(),
                abreviacion: item.abreviacion.trim(),
              }))
          : DEFAULT_PRODUCTOS_MASS_CONFIG.telas,
      colorAbreviaciones:
        parsed.colorAbreviaciones &&
        typeof parsed.colorAbreviaciones === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.colorAbreviaciones).filter(
                ([key, value]) =>
                  typeof key === 'string' && typeof value === 'string',
              ),
            )
          : DEFAULT_PRODUCTOS_MASS_CONFIG.colorAbreviaciones,
      tipos:
        Array.isArray(parsed.tipos) && parsed.tipos.length
          ? parsed.tipos
              .filter(
                (
                  item,
                ): item is {
                  nombre: string;
                  abreviacion: string;
                  categoria?: string;
                  generos: string[];
                  telas: string[];
                  colores?: string[];
                } =>
                  typeof item?.nombre === 'string' &&
                  typeof item?.abreviacion === 'string' &&
                  Array.isArray(item?.generos) &&
                  Array.isArray(item?.telas),
              )
              .map((item) => ({
                nombre: item.nombre.trim(),
                abreviacion: item.abreviacion.trim(),
                categoria:
                  typeof item.categoria === 'string'
                    ? item.categoria.trim()
                    : item.nombre.trim(),
                generos: item.generos
                  .filter((value) => typeof value === 'string')
                  .map((value) => value.trim()),
                telas: item.telas
                  .filter((value) => typeof value === 'string')
                  .map((value) => value.trim()),
                colores: Array.isArray(item.colores)
                  ? item.colores
                      .filter((value) => typeof value === 'string')
                      .map((value) => value.trim())
                  : undefined,
              }))
          : DEFAULT_PRODUCTOS_MASS_CONFIG.tipos,
    };
  }

  private normalizeRoleIds(raw: unknown): number[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return Array.from(
      new Set(
        raw
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0),
      ),
    );
  }
}
