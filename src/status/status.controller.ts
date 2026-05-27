import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StatusService } from './status.service';

@Controller('status')
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  @Get()
  getStatus() {
    return this.statusService.getStatus();
  }

  @UseGuards(JwtAuthGuard)
  @Get('details')
  getDetails(@Req() req: any) {
    return this.statusService.getDetails(req.user);
  }
}
