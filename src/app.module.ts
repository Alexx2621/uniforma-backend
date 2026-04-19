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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LogMiddleware).forRoutes('*');
  }
}
