import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DEFAULT_PRODUCTOS_MASS_CONFIG, ProductosMassConfig } from '../productos/productos-mass-config';

type ModuleConfigState = {
  disabledPaths: string[];
  productionInternalMode: boolean;
  userDisabledPaths: Record<string, string[]>;
  productMassConfig: ProductosMassConfig;
  pedidoAlertRoleIds: number[];
  crossStoreRoleIds: number[];
  unifyOrderRoleIds: number[];
};

@Injectable()
export class NotificacionesConfigService {
  constructor(private prisma: PrismaService) {}

  private readonly moduleConfigPath = join(process.cwd(), 'storage', 'system-config.json');

  private getDefaultModuleConfig(): ModuleConfigState {
    return {
      disabledPaths: [],
      productionInternalMode: false,
      userDisabledPaths: {},
      productMassConfig: DEFAULT_PRODUCTOS_MASS_CONFIG,
      pedidoAlertRoleIds: [],
      crossStoreRoleIds: [],
      unifyOrderRoleIds: [],
    };
  }

  private async ensureConfig() {
    const existing = await this.prisma.notificacionConfig.findUnique({ where: { id: 1 } });
    const config =
      existing ||
      (await this.prisma.notificacionConfig.create({
        data: {
          id: 1,
          emailTo: '',
          whatsappTo: '',
          stockThreshold: 5,
          highSaleThreshold: 1000,
        },
      }));

    const hasHydratedModuleConfig =
      config.disabledPaths !== null ||
      config.userDisabledPaths !== null ||
      config.productMassConfig !== null ||
      config.pedidoAlertRoleIds !== null ||
      config.crossStoreRoleIds !== null ||
      config.unifyOrderRoleIds !== null;

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
        productMassConfig: legacy.productMassConfig as unknown as Prisma.InputJsonValue,
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
        ? parsed.disabledPaths.filter((path: unknown): path is string => typeof path === 'string')
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
        userDisabledPaths: this.normalizeUserDisabledPaths(parsed?.userDisabledPaths),
        productMassConfig: this.normalizeProductMassConfig(parsed?.productMassConfig),
        pedidoAlertRoleIds: this.normalizeRoleIds(parsed?.pedidoAlertRoleIds),
        crossStoreRoleIds: this.normalizeRoleIds(parsed?.crossStoreRoleIds),
        unifyOrderRoleIds: this.normalizeRoleIds(parsed?.unifyOrderRoleIds),
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
  }): ModuleConfigState {
    return {
      disabledPaths: Array.isArray(config.disabledPaths)
        ? config.disabledPaths.filter((path): path is string => typeof path === 'string')
        : [],
      productionInternalMode: Boolean(config.productionInternalMode),
      userDisabledPaths: this.normalizeUserDisabledPaths(config.userDisabledPaths),
      productMassConfig: this.normalizeProductMassConfig(config.productMassConfig),
      pedidoAlertRoleIds: this.normalizeRoleIds(config.pedidoAlertRoleIds),
      crossStoreRoleIds: this.normalizeRoleIds(config.crossStoreRoleIds),
      unifyOrderRoleIds: this.normalizeRoleIds(config.unifyOrderRoleIds),
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
  }) {
    const existing = await this.ensureConfig();
    const moduleConfig = this.extractModuleConfig(existing);

    const config = await this.prisma.notificacionConfig.update({
      where: { id: 1 },
      data: {
        emailTo: data.emailTo ?? existing.emailTo ?? '',
        whatsappTo: data.whatsappTo ?? existing.whatsappTo ?? '',
        stockThreshold: data.stockThreshold ?? existing.stockThreshold ?? 5,
        highSaleThreshold: data.highSaleThreshold ?? existing.highSaleThreshold ?? 1000,
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
            : (this.normalizeProductMassConfig(data.productMassConfig) as unknown as Prisma.InputJsonValue),
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
    };
  }

  private normalizeUserDisabledPaths(raw: unknown): Record<string, string[]> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(raw)
        .filter(([key, value]) => typeof key === 'string' && Array.isArray(value))
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
        typeof parsed.mermaPorcentaje === 'number' && Number.isFinite(parsed.mermaPorcentaje)
          ? parsed.mermaPorcentaje
          : DEFAULT_PRODUCTOS_MASS_CONFIG.mermaPorcentaje,
      generos: Array.isArray(parsed.generos) && parsed.generos.length
        ? parsed.generos
            .filter(
              (item): item is { nombre: string; abreviacion: string } =>
                typeof item?.nombre === 'string' && typeof item?.abreviacion === 'string',
            )
            .map((item) => ({
              nombre: item.nombre.trim(),
              abreviacion: item.abreviacion.trim(),
            }))
        : DEFAULT_PRODUCTOS_MASS_CONFIG.generos,
      telas: Array.isArray(parsed.telas) && parsed.telas.length
        ? parsed.telas
            .filter(
              (item): item is { nombre: string; abreviacion: string } =>
                typeof item?.nombre === 'string' && typeof item?.abreviacion === 'string',
            )
            .map((item) => ({
              nombre: item.nombre.trim(),
              abreviacion: item.abreviacion.trim(),
            }))
        : DEFAULT_PRODUCTOS_MASS_CONFIG.telas,
      colorAbreviaciones:
        parsed.colorAbreviaciones && typeof parsed.colorAbreviaciones === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.colorAbreviaciones).filter(
                ([key, value]) => typeof key === 'string' && typeof value === 'string',
              ),
            )
          : DEFAULT_PRODUCTOS_MASS_CONFIG.colorAbreviaciones,
      tipos: Array.isArray(parsed.tipos) && parsed.tipos.length
        ? parsed.tipos
            .filter(
              (item): item is {
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
              categoria: typeof item.categoria === 'string' ? item.categoria.trim() : item.nombre.trim(),
              generos: item.generos.filter((value) => typeof value === 'string').map((value) => value.trim()),
              telas: item.telas.filter((value) => typeof value === 'string').map((value) => value.trim()),
              colores: Array.isArray(item.colores)
                ? item.colores.filter((value) => typeof value === 'string').map((value) => value.trim())
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
