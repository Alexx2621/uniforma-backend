import { Module } from '@nestjs/common'; import { PrismaModule } from '../prisma.module';
import { AutorizacionesClientesController } from './autorizaciones-clientes.controller'; import { AutorizacionesClientesService } from './autorizaciones-clientes.service';
@Module({ imports:[PrismaModule], controllers:[AutorizacionesClientesController], providers:[AutorizacionesClientesService] }) export class AutorizacionesClientesModule {}
