import { Body, Controller, Get, Put } from '@nestjs/common';
import { NotificacionesConfigService } from './notificaciones.service';

@Controller('config/notificaciones')
export class NotificacionesConfigController {
  constructor(private service: NotificacionesConfigService) {}

  @Get()
  get() {
    return this.service.getConfig();
  }

  @Put()
  update(@Body() body: any) {
    return this.service.updateConfig(body);
  }
}
