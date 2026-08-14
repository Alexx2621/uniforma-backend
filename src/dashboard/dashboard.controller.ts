import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('resumen')
  resumen(@Req() req: any, @Query() query: any) {
    return this.dashboardService.resumen(req.user, query);
  }

  @Get('preferencias')
  preferencias(@Req() req: any) {
    return this.dashboardService.obtenerPreferencias(req.user);
  }

  @Put('preferencias')
  guardarPreferencias(@Req() req: any, @Body() body: unknown) {
    return this.dashboardService.guardarPreferencias(req.user, body);
  }
}
