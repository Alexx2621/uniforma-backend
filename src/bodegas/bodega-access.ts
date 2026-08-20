import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export type BodegaOperacion = 'stock' | 'ventas' | 'traslados' | 'ajustes' | 'pedidos';
export type AuthBodegaUser = { id?: number; rol?: string | null; permisos?: string[] | null; bodegaId?: number | string | null };

const isAdmin = (user?: AuthBodegaUser) => `${user?.rol || ''}`.trim().toUpperCase() === 'ADMIN';

const hasPermission = (user: AuthBodegaUser | undefined, permission: string) =>
  Array.isArray(user?.permisos) && user.permisos.includes(permission);

const flagForOperation = (operacion: BodegaOperacion) => {
  if (operacion === 'ventas') return 'puedeVender';
  if (operacion === 'traslados') return 'puedeTrasladar';
  if (operacion === 'ajustes') return 'puedeAjustar';
  return 'puedeConsultarStock';
};

const bodegaFlagForOperation = (operacion: BodegaOperacion) => {
  if (operacion === 'ventas') return 'permiteVentas';
  if (operacion === 'traslados' || operacion === 'ajustes') return 'permiteTraslados';
  if (operacion === 'pedidos') return 'permitePedidos';
  return null;
};

export async function getAllowedBodegaIds(
  prisma: PrismaService,
  user: AuthBodegaUser | undefined,
  operacion: BodegaOperacion = 'stock',
) {
  if (isAdmin(user) || hasPermission(user, 'sistema.multi-tienda') || hasPermission(user, 'inventario.multi-bodega')) {
    return null;
  }

  const currentUser = await prisma.usuario.findUnique({
    where: { id: Number(user?.id || 0) },
    include: {
      rol: {
        include: {
          permisos: { include: { permiso: true } },
        },
      },
      bodega: true,
      bodegasPermitidas: { include: { bodega: true } },
    },
  });
  if (!currentUser) return [];

  // El rol y los permisos del token pueden quedar desactualizados si se
  // modificaron mientras la sesion seguia abierta. La base de datos es la
  // autoridad final: un ADMIN vigente siempre puede operar cualquier bodega,
  // aunque el token se haya emitido antes del cambio de rol.
  const rolNombre = `${currentUser.rol?.nombre || ''}`.trim().toUpperCase();
  const currentPermissions = new Set(
    currentUser.rol?.permisos?.map((item) => item.permiso.nombre) || [],
  );
  if (
    rolNombre === 'ADMIN' ||
    currentPermissions.has('sistema.multi-tienda') ||
    currentPermissions.has('inventario.multi-bodega')
  ) {
    return null;
  }

  const ids = new Set<number>();
  const opFlag = flagForOperation(operacion);
  const bodegaOpFlag = bodegaFlagForOperation(operacion);

  if (
    currentUser.bodegaId &&
    currentUser.bodega?.activa !== false &&
    (!bodegaOpFlag || Boolean((currentUser.bodega as any)[bodegaOpFlag]))
  ) {
    ids.add(currentUser.bodegaId);
  }

  for (const acceso of currentUser.bodegasPermitidas) {
    if (!Boolean((acceso as any)[opFlag])) continue;
    if (acceso.bodega?.activa === false) continue;
    if (bodegaOpFlag && !Boolean((acceso.bodega as any)[bodegaOpFlag])) continue;
    ids.add(acceso.bodegaId);
  }

  if (rolNombre === 'VENDEDOR' || hasPermission(user, 'inventario.vender-otras-bodegas')) {
    const visibleWhere: any = { activa: true, visibleVendedores: true };
    if (bodegaOpFlag) visibleWhere[bodegaOpFlag] = true;
    const visibles = await prisma.bodega.findMany({ where: visibleWhere, select: { id: true } });
    visibles.forEach((bodega) => ids.add(bodega.id));
  }

  return Array.from(ids);
}

export async function buildBodegaWhere(
  prisma: PrismaService,
  user: AuthBodegaUser | undefined,
  operacion: BodegaOperacion = 'stock',
) {
  const allowedIds = await getAllowedBodegaIds(prisma, user, operacion);
  return allowedIds === null ? {} : { bodegaId: { in: allowedIds.length ? allowedIds : [-1] } };
}

export async function assertBodegaAccess(
  prisma: PrismaService,
  user: AuthBodegaUser | undefined,
  bodegaId: number,
  operacion: BodegaOperacion = 'stock',
) {
  if (!bodegaId) throw new ForbiddenException('Selecciona una bodega valida');
  const allowedIds = await getAllowedBodegaIds(prisma, user, operacion);
  if (allowedIds === null || allowedIds.includes(Number(bodegaId))) return true;
  throw new ForbiddenException('No tienes acceso para operar con esta bodega');
}
