import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OrdenMixtaService } from "./orden-mixta.service";

@Controller("orden-mixta")
@UseGuards(JwtAuthGuard)
export class OrdenMixtaController {
  constructor(private readonly service: OrdenMixtaService) {}

  @Get()
  findAll(@Req() req: any, @Query() query: any) {
    return this.service.findAll(req.user, query);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @Req() req: any) {
    return this.service.findOne(Number(id), req.user);
  }

  @Post()
  create(@Body() data: any, @Req() req: any) {
    return this.service.create(data, req.user);
  }

  @Post("autorizaciones")
  solicitarAutorizacion(@Body() data: any, @Req() req: any) {
    return this.service.solicitarAutorizacionOrdenMixta(data?.orden || data, req.user, data?.comentario);
  }

  @Post("autorizaciones/:id/aprobar")
  aprobarAutorizacion(@Param("id") id: string, @Body() data: any, @Req() req: any) {
    return this.service.aprobarAutorizacionOrdenMixta(Number(id), req.user, data?.comentario);
  }

  @Post("autorizaciones/:id/rechazar")
  rechazarAutorizacion(@Param("id") id: string, @Body() data: any, @Req() req: any) {
    return this.service.rechazarAutorizacionOrdenMixta(Number(id), req.user, data?.comentario);
  }

  @Post(":id/pago")
  registrarPago(@Param("id") id: string, @Body() data: any, @Req() req: any) {
    return this.service.registrarPago(Number(id), data, req.user);
  }
}
