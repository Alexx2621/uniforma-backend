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
  UploadedFile,
  UseInterceptors,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Permissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';

const logoFileInterceptor = FileInterceptor('logo', {
  storage: memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Solo se permiten imagenes'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

@Controller('clientes')
export class ClientesController {
  constructor(private readonly service: ClientesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@Req() req: { user?: { id?: number; rol?: string } }, @Query('usuarioId') usuarioId?: string) {
    return this.service.findAll(req.user, usuarioId ? Number(usuarioId) : undefined);
  }

  @Get('todos')
  @UseGuards(JwtAuthGuard)
  findAllForSelection() {
    return this.service.findAllForSelection();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Get(':id/inteligente')
  @UseGuards(JwtAuthGuard)
  fichaInteligente(@Param('id', ParseIntPipe) id: number) {
    return this.service.fichaInteligente(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(logoFileInterceptor)
  create(
    @Body() body: any,
    @Req() req: { body?: any; user?: { id?: number } },
    @UploadedFile() logo?: { mimetype: string; buffer: Buffer },
  ) {
    const payload = body && Object.keys(body).length ? body : (req.body ?? {});
    return this.service.create(payload, logo, req.user?.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(logoFileInterceptor)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Req() req: { body?: any },
    @UploadedFile() logo?: { mimetype: string; buffer: Buffer },
  ) {
    const payload = body && Object.keys(body).length ? body : (req.body ?? {});
    return this.service.update(id, payload, logo);
  }

  @Patch(':id/cartera')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('clientes.manage')
  asignarCartera(@Param('id', ParseIntPipe) id: number, @Body() body: { usuarioId?: number | null }) {
    return this.service.asignarCartera(id, body?.usuarioId);
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.service.delete(id);
  }
}
