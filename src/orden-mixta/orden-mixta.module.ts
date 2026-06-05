import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { CorrelativosModule } from "../correlativos/correlativos.module";
import { VentasModule } from "../ventas/ventas.module";
import { ProduccionModule } from "../produccion/produccion.module";
import { OrdenMixtaController } from "./orden-mixta.controller";
import { OrdenMixtaService } from "./orden-mixta.service";

@Module({
  imports: [PrismaModule, CorrelativosModule, VentasModule, ProduccionModule],
  controllers: [OrdenMixtaController],
  providers: [OrdenMixtaService],
})
export class OrdenMixtaModule {}
