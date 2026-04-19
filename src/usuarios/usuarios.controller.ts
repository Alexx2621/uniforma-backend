import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

const imageFileInterceptor = FileInterceptor('foto', {
  storage: memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Solo se permiten imagenes'), false);
      return;
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Post()
  @UseInterceptors(imageFileInterceptor)
  crear(
    @Body() data: any,
    @Req() req: { body?: any },
    @UploadedFile() foto?: { mimetype: string; buffer: Buffer },
  ) {
    const payload = data && Object.keys(data).length ? data : (req.body ?? {});
    return this.service.createUser(payload, foto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.service.findOne(Number(id));
  }

  @Patch(':id')
  @UseInterceptors(imageFileInterceptor)
  update(
    @Param('id') id: number,
    @Body() body: any,
    @Req() req: { body?: any },
    @UploadedFile() foto?: { mimetype: string; buffer: Buffer },
  ) {
    const payload = body && Object.keys(body).length ? body : (req.body ?? {});
    return this.service.update(Number(id), payload, foto);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.service.remove(Number(id));
  }
}
