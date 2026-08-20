import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

/**
 * Cuantos intentos fallidos se toleran antes de frenar, y por cuanto tiempo.
 * Cinco deja margen de sobra para un dedazo o para probar dos contrasenas que
 * uno confunde, sin llegar nunca a la racha que el cortafuegos del hosting
 * interpreta como ataque.
 */
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
/** Sin intentos nuevos en este lapso, el registro se olvida. */
const OLVIDO_MS = 30 * 60 * 1000;

@Injectable()
export class AuthService {
  /**
   * Intentos fallidos recientes, contados **por usuario y no por IP**.
   *
   * La razon es la operacion real: una tienda entera sale a internet por una
   * sola IP, asi que contar por IP dejaria fuera a todas las companeras de
   * quien se equivoco. Contando por usuario, el error de una no le quita el
   * sistema a las demas.
   *
   * Sin esto, el unico que reaccionaba ante una racha de fallos era el
   * cortafuegos del hosting, y su reaccion es banear la IP completa: una
   * sucursal sin sistema hasta que el bloqueo expire, sin forma de levantarlo
   * sin soporte. Frenar aqui es preferible en todo sentido.
   *
   * Vive en memoria a proposito: no ensucia la base con escrituras en cada
   * fallo, y que se olvide al reiniciar es deseable, no un defecto.
   */
  private readonly intentos = new Map<string, { fallos: number; bloqueadoHasta: number; visto: number }>();
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private claveIntento(correo: string) {
    return `${correo || ''}`.trim().toLowerCase();
  }

  /**
   * Descarta los registros ya vencidos. Se llama en cada intento: son pocas
   * entradas y evita que la tabla crezca sin limite si alguien prueba miles
   * de usuarios distintos.
   */
  private purgarIntentos() {
    const ahora = Date.now();
    for (const [clave, registro] of this.intentos) {
      // Se conserva mientras el bloqueo siga vigente; pasado eso, basta con
      // que lleve rato sin actividad. Sin la marca de tiempo, quien fallaba
      // un par de veces y no volvia dejaba su registro para siempre.
      if (registro.bloqueadoHasta > ahora) continue;
      if (ahora - registro.visto >= OLVIDO_MS) this.intentos.delete(clave);
    }
  }

  private registrarFallo(correo: string) {
    const clave = this.claveIntento(correo);
    const registro = this.intentos.get(clave) || { fallos: 0, bloqueadoHasta: 0, visto: 0 };
    registro.fallos += 1;
    registro.visto = Date.now();
    if (registro.fallos >= MAX_INTENTOS) {
      registro.bloqueadoHasta = Date.now() + BLOQUEO_MS;
      registro.fallos = 0;
    }
    this.intentos.set(clave, registro);
  }

  async login(correo: string, password: string) {
    this.purgarIntentos();

    // Se comprueba antes de tocar la base: un usuario frenado no genera ni
    // consultas ni comparaciones de contrasena.
    const registro = this.intentos.get(this.claveIntento(correo));
    if (registro && registro.bloqueadoHasta > Date.now()) {
      const minutos = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
      throw new UnauthorizedException(
        `Demasiados intentos fallidos. Espera ${minutos} minuto${minutos === 1 ? '' : 's'} y vuelve a intentar.`,
      );
    }

    const user = await this.prisma.usuario.findUnique({
      where: { correo },
      include: {
        rol: {
          include: {
            permisos: {
              include: { permiso: true },
            },
          },
        },
        bodega: true,
        bodegasPermitidas: { include: { bodega: true } },
      },
    });

    if (!user) {
      // Se cuenta igual aunque el usuario no exista: si no, la diferencia de
      // comportamiento delataria que correos estan dados de alta.
      this.registrarFallo(correo);
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    if (!user.activo) {
      throw new UnauthorizedException('Usuario deshabilitado. Contacta a un administrador');
    }

    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      this.registrarFallo(correo);
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    // Entro bien: se le borra el historial de fallos.
    this.intentos.delete(this.claveIntento(correo));

    const payload = {
      sub: user.id,
      usuario: user.usuario,
      correo: user.correo,
      usuarioCorrelativo: user.usuarioCorrelativo,
      rol: user.rol.nombre,
      rolId: user.rolId,
      permisos: user.rol.permisos.map((item) => item.permiso.nombre),
      bodegaId: user.bodegaId ?? null,
    };

    const token = await this.jwtService.signAsync(payload);

    return {
      token,
      id: user.id,
      usuario: user.usuario,
      usuarioCorrelativo: user.usuarioCorrelativo,
      correo: user.correo,
      nombre: user.nombre,
      primerNombre: user.primerNombre,
      primerApellido: user.primerApellido,
      segundoApellido: user.segundoApellido,
      fotoUrl: user.fotoUrl,
      rol: user.rol.nombre,
      rolId: user.rolId,
      permisos: user.rol.permisos.map((item) => item.permiso.nombre),
      bodegaId: user.bodegaId ?? null,
      bodegaNombre: user.bodega?.nombre ?? null,
      bodegasPermitidas: user.bodegasPermitidas.map((item) => ({
        id: item.bodegaId,
        nombre: item.bodega.nombre,
        tipo: item.bodega.tipo,
        puedeConsultarStock: item.puedeConsultarStock,
        puedeVender: item.puedeVender,
        puedeTrasladar: item.puedeTrasladar,
        puedeAjustar: item.puedeAjustar,
      })),
    };
  }

  async me(userId: number) {
    const user = await this.prisma.usuario.findUnique({
      where: { id: userId },
      include: {
        rol: {
          include: {
            permisos: {
              include: { permiso: true },
            },
          },
        },
        bodega: true,
        bodegasPermitidas: { include: { bodega: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    return {
      id: user.id,
      usuario: user.usuario,
      usuarioCorrelativo: user.usuarioCorrelativo,
      nombre: user.nombre,
      primerNombre: user.primerNombre,
      primerApellido: user.primerApellido,
      segundoApellido: user.segundoApellido,
      fotoUrl: user.fotoUrl,
      rol: user.rol?.nombre ?? null,
      rolId: user.rolId,
      permisos: user.rol?.permisos?.map((item) => item.permiso.nombre) ?? [],
      bodegaId: user.bodegaId ?? null,
      bodegaNombre: user.bodega?.nombre ?? null,
      bodegasPermitidas: user.bodegasPermitidas.map((item) => ({
        id: item.bodegaId,
        nombre: item.bodega.nombre,
        tipo: item.bodega.tipo,
        puedeConsultarStock: item.puedeConsultarStock,
        puedeVender: item.puedeVender,
        puedeTrasladar: item.puedeTrasladar,
        puedeAjustar: item.puedeAjustar,
      })),
    };
  }
}
