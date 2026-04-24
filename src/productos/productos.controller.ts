import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ProductosService } from './productos.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('productos')
export class ProductosController {
  constructor(private readonly service: ProductosService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post('carga-masiva-base')
  cargaMasivaBase(@Body() body?: { config?: unknown }) {
    return this.service.cargaMasivaBase(body?.config);
  }

  @Get('carga-masiva-base/preview')
  previewCargaMasivaBase() {
    return this.service.previewCargaMasivaBase();
  }

  @Post('carga-masiva-base/preview')
  previewCargaMasivaBasePost(@Body() body?: { config?: unknown }) {
    return this.service.previewCargaMasivaBase(body?.config);
  }

  @Post('actualizacion-masiva/preview')
  previewActualizacionMasiva(@Body() body: any) {
    return this.service.previewActualizacionMasiva(body);
  }

  @Post('actualizacion-masiva')
  actualizacionMasiva(@Body() body: any) {
    return this.service.actualizacionMasiva(body);
  }

  @Post('creacion-masiva/preview')
  previewCreacionMasiva(@Body() body: any) {
    return this.service.previewCreacionMasiva(body);
  }

  @Post('creacion-masiva')
  creacionMasiva(@Body() body: any) {
    return this.service.creacionMasiva(body);
  }

  @Get('codigo/:codigo')
  buscarPorCodigo(@Param('codigo') codigo: string) {
    return this.service.buscarPorCodigo(codigo.toUpperCase());
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() body: any, @Req() req: any) {
    if (req.user?.rol === 'VENTAS') {
      throw new ForbiddenException('El rol VENTAS no puede crear productos');
    }
    return this.service.create(body);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    if (req.user?.rol === 'VENTAS') {
      throw new ForbiddenException('El rol VENTAS no puede editar productos');
    }
    return this.service.update(id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  delete(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (req.user?.rol === 'VENTAS') {
      throw new ForbiddenException('El rol VENTAS no puede eliminar productos');
    }
    return this.service.delete(id);
  }
}
