import { MiddlewareConsumer, NestModule, Module } from '@nestjs/common';
import { PrismaModule } from './prisma.module';
import { CategoriasModule } from './categorias/categorias.module';
import { TelasModule } from './telas/telas.module';
import { ColoresModule } from './colores/colores.module';
import { TallasModule } from './tallas/tallas.module';
import { ProductosModule } from './productos/productos.module';
import { ClientesModule } from './clientes/clientes.module';
import { VentasModule } from './ventas/ventas.module';
import { IngresosModule } from './ingresos/ingresos.module';
import { TrasladosModule } from './traslados/traslados.module';
import { InventarioModule } from './inventario/inventario.module';
import { ProduccionModule } from './produccion/produccion.module';
import { RolesModule } from './roles/roles.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { AuthModule } from './auth/auth.module';
import { BodegasModule } from './bodegas/bodegas.module';
import { NotificacionesConfigModule } from './config/notificaciones.module';
import { CorrelativosModule } from './correlativos/correlativos.module';
import { AlertasModule } from './alertas/alertas.module';
import { DocumentosModule } from './documentos/documentos.module';
import { PostventaModule } from './postventa/postventa.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { TrackingModule } from './tracking/tracking.module';
import { CorreccionesModule } from './correcciones/correcciones.module';
import { MetasModule } from './metas/metas.module';
import { EnviosModule } from './envios/envios.module';
import { RelacionesModule } from './relaciones/relaciones.module';
import { StatusModule } from './status/status.module';
import { InventarioTelasModule } from './inventario-telas/inventario-telas.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { FacturasProveedoresModule } from './facturas-proveedores/facturas-proveedores.module';
import { DashboardModule } from './dashboard/dashboard.module';

import { LogMiddleware } from './common/log.middleware';
import { LogsModule } from './logs/logs.module';

@Module({
  imports: [
    PrismaModule,
    CategoriasModule,
    TelasModule,
    ColoresModule,
    TallasModule,
    ProductosModule,
    ClientesModule,
    VentasModule,
    IngresosModule,
    TrasladosModule,
    InventarioModule,
    ProduccionModule,
    RolesModule,
    UsuariosModule,
    AuthModule,
    LogsModule,
    BodegasModule,
    NotificacionesConfigModule,
    CorrelativosModule,
    AlertasModule,
    DocumentosModule,
    PostventaModule,
    WhatsappModule,
    TrackingModule,
    CorreccionesModule,
    MetasModule,
    EnviosModule,
    RelacionesModule,
    StatusModule,
    InventarioTelasModule,
    ProveedoresModule,
    FacturasProveedoresModule,
    DashboardModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LogMiddleware).forRoutes('*');
  }
}
