import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FacturasProveedoresService } from './facturas-proveedores.service';

const facturaFileInterceptor = FileInterceptor('archivo', {
  storage: memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Solo se permiten facturas en PDF'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 8 * 1024 * 1024 },
});

@Controller('facturas-proveedores')
@UseGuards(JwtAuthGuard)
export class FacturasProveedoresController {
  constructor(private readonly service: FacturasProveedoresService) {}

  @Get()
  findAll(
    @Query('q') q?: string,
    @Query('estado') estado?: string,
    @Query('proveedorId') proveedorId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.service.findAll({ q, estado, proveedorId, desde, hasta });
  }

  @Get(':id/pdf')
  async pdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.service.getPdf(id);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `inline; filename="${file.name}"`);
    res.send(file.buffer);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Post('cargar-pdf')
  @UseInterceptors(facturaFileInterceptor)
  upload(@UploadedFile() archivo: { originalname: string; mimetype: string; buffer: Buffer }, @Body() body: any) {
    return this.service.uploadPdf(archivo, body);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
