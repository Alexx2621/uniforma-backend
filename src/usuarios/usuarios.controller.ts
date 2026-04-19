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
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';

const uploadDir = join(process.cwd(), 'storage', 'usuarios');
mkdirSync(uploadDir, { recursive: true });

const imageFileInterceptor = FileInterceptor('foto', {
  storage: diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `usuario-${uniqueSuffix}${extname(file.originalname || '')}`);
    },
  }),
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
    @UploadedFile() foto?: { filename: string },
  ) {
    const payload = data && Object.keys(data).length ? data : (req.body ?? {});
    return this.service.createUser(payload, foto ? `/storage/usuarios/${foto.filename}` : null);
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
    @UploadedFile() foto?: { filename: string },
  ) {
    const payload = body && Object.keys(body).length ? body : (req.body ?? {});
    return this.service.update(
      Number(id),
      payload,
      foto ? `/storage/usuarios/${foto.filename}` : undefined,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.service.remove(Number(id));
  }
}
