import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() data: { correo: string; password: string }) {
    return this.auth.login(data.correo, data.password);
  }
}
