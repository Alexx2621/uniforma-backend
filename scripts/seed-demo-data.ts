import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PERMISSION_CATALOG } from '../src/roles/permission-catalog';

const prisma = new PrismaClient();

async function resetDatabase() {
  await prisma.alertaInterna.deleteMany();
  await prisma.rolPermiso.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.pagoVenta.deleteMany();
  await prisma.detalleVenta.deleteMany();
  await prisma.venta.deleteMany();
  await prisma.detalleIngreso.deleteMany();
  await prisma.ingresoInventario.deleteMany();
  await prisma.detalleTraslado.deleteMany();
  await prisma.traslado.deleteMany();
  await prisma.movInventario.deleteMany();
  await prisma.inventario.deleteMany();
  await prisma.imagenProducto.deleteMany();
  await prisma.consumoInsumo.deleteMany();
  await prisma.costosProduccion.deleteMany();
  await prisma.mermaProduccion.deleteMany();
  await prisma.produccionAvance.deleteMany();
  await prisma.pagoPedido.deleteMany();
  await prisma.detallePedidoProduccion.deleteMany();
  await prisma.pedidoProduccion.deleteMany();
  await prisma.detalleOrdenCompra.deleteMany();
  await prisma.ordenCompra.deleteMany();
  await prisma.logAcceso.deleteMany();
  await prisma.correlativoConfig.deleteMany();
  await prisma.proveedor.deleteMany();
  await prisma.insumo.deleteMany();
  await prisma.producto.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.permiso.deleteMany();
  await prisma.rol.deleteMany();
  await prisma.bodega.deleteMany();
  await prisma.categoria.deleteMany();
  await prisma.tela.deleteMany();
  await prisma.color.deleteMany();
  await prisma.talla.deleteMany();
  await prisma.notificacionConfig.deleteMany();
}

async function seedCatalogs() {
  const categorias = await Promise.all([
    prisma.categoria.create({ data: { nombre: 'FILIPINA', descripcion: 'Prenda superior clinica' } }),
    prisma.categoria.create({ data: { nombre: 'PANTALON', descripcion: 'Pantalon para uniforme medico' } }),
    prisma.categoria.create({ data: { nombre: 'BATA', descripcion: 'Bata de laboratorio y consulta' } }),
  ]);

  const telas = await Promise.all([
    prisma.tela.create({ data: { nombre: 'REPEL', descripcion: 'Tela antifluido de uso clinico' } }),
    prisma.tela.create({ data: { nombre: 'SWAN', descripcion: 'Tela suave para uniforme premium' } }),
    prisma.tela.create({ data: { nombre: 'ALGODON', descripcion: 'Tela fresca para uso diario' } }),
  ]);

  const colores = await Promise.all([
    prisma.color.create({ data: { nombre: 'AZUL MARINO', codigoHex: '#123C69' } }),
    prisma.color.create({ data: { nombre: 'BLANCO', codigoHex: '#FFFFFF' } }),
    prisma.color.create({ data: { nombre: 'NEGRO', codigoHex: '#111111' } }),
    prisma.color.create({ data: { nombre: 'CELESTE', codigoHex: '#8ED1FC' } }),
  ]);

  const tallas = await Promise.all([
    prisma.talla.create({ data: { nombre: 'S' } }),
    prisma.talla.create({ data: { nombre: 'M' } }),
    prisma.talla.create({ data: { nombre: 'L' } }),
    prisma.talla.create({ data: { nombre: 'XL' } }),
  ]);

  return { categorias, telas, colores, tallas };
}

async function seedBodegas() {
  const central = await prisma.bodega.create({
    data: {
      nombre: 'Bodega Central',
      ubicacion: 'Ciudad de Guatemala',
    },
  });

  const zona10 = await prisma.bodega.create({
    data: {
      nombre: 'Showroom Zona 10',
      ubicacion: 'Zona 10, Ciudad de Guatemala',
    },
  });

  const antigua = await prisma.bodega.create({
    data: {
      nombre: 'Sucursal Antigua',
      ubicacion: 'Antigua Guatemala',
    },
  });

  await prisma.correlativoConfig.createMany({
    data: [
      {
        tipo: 'PRODUCCION_UNIFICADO',
        scope: 'GLOBAL',
        nombre: 'Todas las tiendas',
        abreviatura: 'UNI',
        siguienteNumero: 25,
        bodegaId: null,
        activo: true,
      },
      {
        tipo: 'PRODUCCION_UNIFICADO',
        scope: `BODEGA:${central.id}`,
        nombre: central.nombre,
        abreviatura: 'BCEN',
        siguienteNumero: 8,
        bodegaId: central.id,
        activo: true,
      },
      {
        tipo: 'PRODUCCION_UNIFICADO',
        scope: `BODEGA:${zona10.id}`,
        nombre: zona10.nombre,
        abreviatura: 'Z10',
        siguienteNumero: 4,
        bodegaId: zona10.id,
        activo: true,
      },
      {
        tipo: 'PRODUCCION_UNIFICADO',
        scope: `BODEGA:${antigua.id}`,
        nombre: antigua.nombre,
        abreviatura: 'ANT',
        siguienteNumero: 2,
        bodegaId: antigua.id,
        activo: true,
      },
    ],
  });

  return { central, zona10, antigua };
}

async function seedRolesAndUsers(bodegas: {
  central: { id: number; nombre: string };
  zona10: { id: number; nombre: string };
  antigua: { id: number; nombre: string };
}) {
  await prisma.permiso.createMany({
    data: PERMISSION_CATALOG.map((permission) => ({
      nombre: permission.key,
      descripcion: `${permission.category}: ${permission.label} - ${permission.description}`,
    })),
  });

  const permisos = await prisma.permiso.findMany({ orderBy: { id: 'asc' } });
  const permisoByName = new Map(permisos.map((permiso) => [permiso.nombre, permiso]));

  const adminRole = await prisma.rol.create({
    data: {
      nombre: 'Administrador',
      descripcion: 'Acceso completo al sistema',
    },
  });

  const ventasRole = await prisma.rol.create({
    data: {
      nombre: 'Ventas',
      descripcion: 'Acceso a ventas, clientes y consulta de inventario',
    },
  });

  const produccionRole = await prisma.rol.create({
    data: {
      nombre: 'Produccion',
      descripcion: 'Acceso a produccion y movimientos de bodega',
    },
  });

  await prisma.rolPermiso.createMany({
    data: [
      ...permisos.map((permiso) => ({
        rolId: adminRole.id,
        permisoId: permiso.id,
      })),
      ...[
        'dashboard.view',
        'ventas.view',
        'ventas.manage',
        'productos.view',
        'clientes.view',
        'clientes.manage',
        'inventario.resumen.view',
        'reportes.ventas-diarias.view',
        'reportes.top-clientes.view',
      ].map((permiso) => ({
        rolId: ventasRole.id,
        permisoId: permisoByName.get(permiso)!.id,
      })),
      ...[
        'dashboard.view',
        'productos.view',
        'inventario.ingreso.view',
        'inventario.traslados.view',
        'inventario.resumen.view',
        'produccion.view',
        'produccion.manage',
        'reportes.ingresos.view',
        'reportes.traslados.view',
        'reportes.stock-bajo.view',
      ].map((permiso) => ({
        rolId: produccionRole.id,
        permisoId: permisoByName.get(permiso)!.id,
      })),
    ],
  });

  const passwordHash = await bcrypt.hash('Admin123*', 10);

  const admin = await prisma.usuario.create({
    data: {
      nombre: 'Bryan Admin Uniforma',
      primerNombre: 'Bryan',
      primerApellido: 'Admin',
      segundoApellido: 'Uniforma',
      usuario: 'bryan.admin',
      correo: 'admin@uniforma.local',
      telefono: '5555-1000',
      dpi: '1000000000101',
      direccion: 'Ciudad de Guatemala',
      password: passwordHash,
      rolId: adminRole.id,
      bodegaId: bodegas.central.id,
      activo: true,
    },
  });

  const salesUser = await prisma.usuario.create({
    data: {
      nombre: 'Andrea Ventas Uniforma',
      primerNombre: 'Andrea',
      primerApellido: 'Ventas',
      segundoApellido: 'Uniforma',
      usuario: 'andrea.ventas',
      correo: 'ventas@uniforma.local',
      telefono: '5555-2000',
      dpi: '1000000000202',
      direccion: 'Zona 10',
      password: passwordHash,
      rolId: ventasRole.id,
      bodegaId: bodegas.zona10.id,
      activo: true,
    },
  });

  const productionUser = await prisma.usuario.create({
    data: {
      nombre: 'Carlos Produccion Uniforma',
      primerNombre: 'Carlos',
      primerApellido: 'Produccion',
      segundoApellido: 'Uniforma',
      usuario: 'carlos.produccion',
      correo: 'produccion@uniforma.local',
      telefono: '5555-3000',
      dpi: '1000000000303',
      direccion: 'Antigua Guatemala',
      password: passwordHash,
      rolId: produccionRole.id,
      bodegaId: bodegas.antigua.id,
      activo: true,
    },
  });

  return {
    roles: { adminRole, ventasRole, produccionRole },
    users: { admin, salesUser, productionUser },
  };
}

async function seedClientesYProveedores() {
  const clientes = await Promise.all([
    prisma.cliente.create({
      data: {
        nombre: 'Hospital San Gabriel',
        telefono: '2388-1200',
        correo: 'compras@hospitalsangabriel.com',
        direccion: 'Zona 9, Ciudad de Guatemala',
        tipoCliente: 'EMPRESA',
      },
    }),
    prisma.cliente.create({
      data: {
        nombre: 'Clinica La Merced',
        telefono: '7832-4411',
        correo: 'administracion@lamerced.gt',
        direccion: 'Antigua Guatemala',
        tipoCliente: 'CLINICA',
      },
    }),
  ]);

  const proveedores = await Promise.all([
    prisma.proveedor.create({
      data: {
        nombre: 'Textiles Centroamericanos',
        contacto: 'Mariela Gomez',
        telefono: '2244-5000',
        correo: 'ventas@textilesca.gt',
        direccion: 'Mixco, Guatemala',
        tipo: 'TELAS',
      },
    }),
    prisma.proveedor.create({
      data: {
        nombre: 'Insumos Medicos GT',
        contacto: 'Jose Paredes',
        telefono: '2311-8800',
        correo: 'contacto@insumosmedicos.gt',
        direccion: 'Villa Nueva, Guatemala',
        tipo: 'INSUMOS',
      },
    }),
  ]);

  return { clientes, proveedores };
}

async function seedInsumos() {
  return Promise.all([
    prisma.insumo.create({
      data: {
        nombre: 'Tela antifluido azul',
        tipo: 'TELA',
        unidad: 'yarda',
        stock: 120,
        stockMin: 20,
        costoPromedio: 28,
      },
    }),
    prisma.insumo.create({
      data: {
        nombre: 'Hilo poliester blanco',
        tipo: 'HILO',
        unidad: 'cono',
        stock: 45,
        stockMin: 8,
        costoPromedio: 18,
      },
    }),
    prisma.insumo.create({
      data: {
        nombre: 'Boton plastico negro',
        tipo: 'ACCESORIO',
        unidad: 'docena',
        stock: 60,
        stockMin: 10,
        costoPromedio: 9,
      },
    }),
  ]);
}

async function seedProductos(catalogs: {
  categorias: { id: number; nombre: string }[];
  telas: { id: number; nombre: string }[];
  colores: { id: number; nombre: string }[];
  tallas: { id: number; nombre: string }[];
}) {
  const categoriaByName = new Map(catalogs.categorias.map((item) => [item.nombre, item]));
  const telaByName = new Map(catalogs.telas.map((item) => [item.nombre, item]));
  const colorByName = new Map(catalogs.colores.map((item) => [item.nombre, item]));
  const tallaByName = new Map(catalogs.tallas.map((item) => [item.nombre, item]));

  const productos = await Promise.all([
    prisma.producto.create({
      data: {
        codigo: 'FDRMAZ',
        nombre: 'Filipina dama repel azul',
        genero: 'DAMA',
        tipo: 'FILIPINA',
        precio: 245,
        mermaPorcentaje: 4,
        stockMax: 30,
        categoriaId: categoriaByName.get('FILIPINA')!.id,
        telaId: telaByName.get('REPEL')!.id,
        colorId: colorByName.get('AZUL MARINO')!.id,
        tallaId: tallaByName.get('M')!.id,
      },
    }),
    prisma.producto.create({
      data: {
        codigo: 'PCRLNE',
        nombre: 'Pantalon caballero repel negro',
        genero: 'CABALLERO',
        tipo: 'PANTALON',
        precio: 225,
        mermaPorcentaje: 3,
        stockMax: 25,
        categoriaId: categoriaByName.get('PANTALON')!.id,
        telaId: telaByName.get('REPEL')!.id,
        colorId: colorByName.get('NEGRO')!.id,
        tallaId: tallaByName.get('L')!.id,
      },
    }),
    prisma.producto.create({
      data: {
        codigo: 'BSWLBL',
        nombre: 'Bata swan blanca',
        genero: 'UNISEX',
        tipo: 'BATA',
        precio: 280,
        mermaPorcentaje: 5,
        stockMax: 20,
        categoriaId: categoriaByName.get('BATA')!.id,
        telaId: telaByName.get('SWAN')!.id,
        colorId: colorByName.get('BLANCO')!.id,
        tallaId: tallaByName.get('L')!.id,
      },
    }),
    prisma.producto.create({
      data: {
        codigo: 'FCSCEL',
        nombre: 'Filipina caballero swan celeste',
        genero: 'CABALLERO',
        tipo: 'FILIPINA',
        precio: 255,
        mermaPorcentaje: 4,
        stockMax: 18,
        categoriaId: categoriaByName.get('FILIPINA')!.id,
        telaId: telaByName.get('SWAN')!.id,
        colorId: colorByName.get('CELESTE')!.id,
        tallaId: tallaByName.get('S')!.id,
      },
    }),
  ]);

  await prisma.imagenProducto.createMany({
    data: [
      {
        productoId: productos[0].id,
        url: 'https://images.unsplash.com/photo-1584515933487-779824d29309',
        descripcion: 'Filipina azul de prueba',
        esPrincipal: true,
      },
      {
        productoId: productos[2].id,
        url: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118',
        descripcion: 'Bata blanca de laboratorio',
        esPrincipal: true,
      },
    ],
  });

  return productos;
}

async function seedInventarioYMovimientos(bodegas: {
  central: { id: number; nombre: string };
  zona10: { id: number; nombre: string };
  antigua: { id: number; nombre: string };
}, productos: { id: number; codigo: string; precio: number }[]) {
  await prisma.inventario.createMany({
    data: [
      { bodegaId: bodegas.central.id, productoId: productos[0].id, stock: 18 },
      { bodegaId: bodegas.central.id, productoId: productos[1].id, stock: 12 },
      { bodegaId: bodegas.central.id, productoId: productos[2].id, stock: 9 },
      { bodegaId: bodegas.zona10.id, productoId: productos[0].id, stock: 6 },
      { bodegaId: bodegas.zona10.id, productoId: productos[3].id, stock: 5 },
      { bodegaId: bodegas.antigua.id, productoId: productos[1].id, stock: 4 },
      { bodegaId: bodegas.antigua.id, productoId: productos[2].id, stock: 3 },
    ],
  });

  const ingreso = await prisma.ingresoInventario.create({
    data: {
      bodegaId: bodegas.central.id,
      observaciones: 'Ingreso inicial de inventario para nueva instalacion',
    },
  });

  await prisma.detalleIngreso.createMany({
    data: [
      { ingresoId: ingreso.id, productoId: productos[0].id, cantidad: 20 },
      { ingresoId: ingreso.id, productoId: productos[1].id, cantidad: 15 },
      { ingresoId: ingreso.id, productoId: productos[2].id, cantidad: 10 },
    ],
  });

  const traslado = await prisma.traslado.create({
    data: {
      desdeBodegaId: bodegas.central.id,
      haciaBodegaId: bodegas.zona10.id,
      observaciones: 'Reposicion semanal de showroom',
    },
  });

  await prisma.detalleTraslado.createMany({
    data: [
      { trasladoId: traslado.id, productoId: productos[0].id, cantidad: 4 },
      { trasladoId: traslado.id, productoId: productos[3].id, cantidad: 2 },
    ],
  });

  await prisma.movInventario.createMany({
    data: [
      {
        bodegaId: bodegas.central.id,
        productoId: productos[0].id,
        tipo: 'INGRESO',
        cantidad: 20,
        referencia: `ING-${ingreso.id}`,
      },
      {
        bodegaId: bodegas.central.id,
        productoId: productos[0].id,
        tipo: 'TRASLADO_SALIDA',
        cantidad: -4,
        referencia: `TRA-${traslado.id}`,
      },
      {
        bodegaId: bodegas.zona10.id,
        productoId: productos[0].id,
        tipo: 'TRASLADO_ENTRADA',
        cantidad: 4,
        referencia: `TRA-${traslado.id}`,
      },
      {
        bodegaId: bodegas.antigua.id,
        productoId: productos[2].id,
        tipo: 'AJUSTE',
        cantidad: -1,
        referencia: 'AJUSTE-INVENTARIO',
      },
    ],
  });

  return { ingreso, traslado };
}

async function seedVentas(
  clientes: { id: number; nombre: string }[],
  bodegas: { central: { id: number }; zona10: { id: number } },
  productos: { id: number; precio: number }[],
) {
  const venta = await prisma.venta.create({
    data: {
      clienteId: clientes[0].id,
      total: 715,
      metodoPago: 'Mixto',
      ubicacion: 'Mostrador Zona 10',
      recargo: 15,
      observaciones: 'Venta de uniformes para personal de enfermeria',
      bodegaId: bodegas.zona10.id,
      vendedor: 'Andrea Ventas Uniforma',
    },
  });

  await prisma.detalleVenta.createMany({
    data: [
      {
        ventaId: venta.id,
        productoId: productos[0].id,
        cantidad: 2,
        precioUnit: productos[0].precio,
        bordado: 10,
        descuento: 0,
        descripcion: 'Con logo institucional',
        subtotal: 500,
      },
      {
        ventaId: venta.id,
        productoId: productos[3].id,
        cantidad: 1,
        precioUnit: productos[3].precio,
        bordado: 0,
        descuento: 40,
        descripcion: 'Promocion de mostrador',
        subtotal: 215,
      },
    ],
  });

  await prisma.pagoVenta.createMany({
    data: [
      { ventaId: venta.id, metodo: 'Tarjeta', monto: 500 },
      { ventaId: venta.id, metodo: 'Efectivo', monto: 215 },
    ],
  });

  return venta;
}

async function seedComprasEInsumos(
  proveedorId: number,
  insumos: { id: number }[],
) {
  const orden = await prisma.ordenCompra.create({
    data: {
      proveedorId,
      estado: 'recibida',
      total: 860,
      observaciones: 'Reposicion de insumos base de produccion',
    },
  });

  await prisma.detalleOrdenCompra.createMany({
    data: [
      { ordenId: orden.id, insumoId: insumos[0].id, cantidad: 20, costoUnit: 28, subtotal: 560 },
      { ordenId: orden.id, insumoId: insumos[1].id, cantidad: 10, costoUnit: 18, subtotal: 180 },
      { ordenId: orden.id, insumoId: insumos[2].id, cantidad: 10, costoUnit: 12, subtotal: 120 },
    ],
  });

  return orden;
}

async function seedProduccion(
  clienteId: number,
  bodegaId: number,
  producto: { id: number; precio: number },
  insumos: { id: number }[],
) {
  const pedido = await prisma.pedidoProduccion.create({
    data: {
      estado: 'en_proceso',
      solicitadoPor: 'Bryan Admin Uniforma',
      observaciones: 'Pedido especial para clinica con logo bordado',
      clienteId,
      bodegaId,
      totalEstimado: 980,
      anticipo: 300,
      saldoPendiente: 680,
      recargo: 0,
      porcentajeRecargo: 0,
      metodoPago: 'Transferencia',
    },
  });

  await prisma.detallePedidoProduccion.create({
    data: {
      pedidoId: pedido.id,
      productoId: producto.id,
      cantidad: 4,
      precioUnit: producto.precio,
      descuento: 0,
      descripcion: 'Filipinas bordadas para equipo medico',
    },
  });

  await prisma.pagoPedido.create({
    data: {
      pedidoId: pedido.id,
      monto: 300,
      metodo: 'Transferencia',
      tipo: 'anticipo',
      recargo: 0,
      porcentajeRecargo: 0,
    },
  });

  await prisma.produccionAvance.createMany({
    data: [
      {
        pedidoId: pedido.id,
        fase: 'CORTE',
        cantidad: 4,
        responsable: 'Carlos Produccion Uniforma',
      },
      {
        pedidoId: pedido.id,
        fase: 'CONFECCION',
        cantidad: 2,
        responsable: 'Carlos Produccion Uniforma',
      },
    ],
  });

  await prisma.mermaProduccion.create({
    data: {
      insumoId: insumos[0].id,
      pedidoId: pedido.id,
      cantidad: 1.5,
      motivo: 'Recorte y ajuste de patron',
    },
  });

  await prisma.consumoInsumo.createMany({
    data: [
      { productoId: producto.id, insumoId: insumos[0].id, cantidadPorUnidad: 1.75 },
      { productoId: producto.id, insumoId: insumos[1].id, cantidadPorUnidad: 0.15 },
      { productoId: producto.id, insumoId: insumos[2].id, cantidadPorUnidad: 0.08 },
    ],
  });

  await prisma.costosProduccion.create({
    data: {
      productoId: producto.id,
      costoInsumos: 95,
      costoManoObra: 48,
      costoOperativo: 22,
      costoTotal: 165,
    },
  });

  return pedido;
}

async function seedBitacoraYConfig(data: {
  adminUserId: number;
  adminRoleId: number;
  adminName: string;
}) {
  await prisma.notificacionConfig.create({
    data: {
      id: 1,
      emailTo: 'alertas@uniforma.local',
      whatsappTo: '+50255551234',
      stockThreshold: 5,
      highSaleThreshold: 1000,
    },
  });

  await prisma.alertaInterna.createMany({
    data: [
      {
        usuarioId: data.adminUserId,
        rolId: data.adminRoleId,
        tipo: 'stock_bajo',
        titulo: 'Stock bajo detectado',
        mensaje: 'La bata blanca talla L tiene menos de 5 unidades disponibles.',
        payload: JSON.stringify({ producto: 'BSWLBL', stock: 3 }),
        leida: false,
      },
      {
        usuarioId: data.adminUserId,
        rolId: data.adminRoleId,
        tipo: 'venta_alta',
        titulo: 'Venta relevante registrada',
        mensaje: 'Se registro una venta de prueba para Hospital San Gabriel.',
        payload: JSON.stringify({ ventaId: 1, total: 715 }),
        leida: true,
        leidaEn: new Date(),
      },
    ],
  });

  await prisma.logAcceso.createMany({
    data: [
      {
        usuario: data.adminName,
        endpoint: '/auth/login',
        metodo: 'POST',
        ip: '127.0.0.1',
        resultado: 'OK',
      },
      {
        usuario: data.adminName,
        endpoint: '/productos',
        metodo: 'GET',
        ip: '127.0.0.1',
        resultado: 'OK',
      },
      {
        usuario: 'Sistema',
        endpoint: '/produccion',
        metodo: 'POST',
        ip: '127.0.0.1',
        resultado: 'CREATED',
      },
    ],
  });
}

async function main() {
  console.log('Limpiando datos anteriores...');
  await resetDatabase();

  console.log('Sembrando catalogos...');
  const catalogs = await seedCatalogs();

  console.log('Sembrando bodegas y correlativos...');
  const bodegas = await seedBodegas();

  console.log('Sembrando roles, permisos y usuarios...');
  const { roles, users } = await seedRolesAndUsers(bodegas);

  console.log('Sembrando clientes, proveedores e insumos...');
  const { clientes, proveedores } = await seedClientesYProveedores();
  const insumos = await seedInsumos();

  console.log('Sembrando productos...');
  const productos = await seedProductos(catalogs);

  console.log('Sembrando inventario y movimientos...');
  await seedInventarioYMovimientos(bodegas, productos);

  console.log('Sembrando ventas...');
  await seedVentas(clientes, bodegas, productos);

  console.log('Sembrando compras...');
  await seedComprasEInsumos(proveedores[1].id, insumos);

  console.log('Sembrando produccion...');
  await seedProduccion(clientes[1].id, bodegas.central.id, productos[0], insumos);

  console.log('Sembrando bitacora y configuracion...');
  await seedBitacoraYConfig({
    adminUserId: users.admin.id,
    adminRoleId: roles.adminRole.id,
    adminName: users.admin.nombre,
  });

  const resumen = {
    categorias: await prisma.categoria.count(),
    telas: await prisma.tela.count(),
    colores: await prisma.color.count(),
    tallas: await prisma.talla.count(),
    productos: await prisma.producto.count(),
    clientes: await prisma.cliente.count(),
    ventas: await prisma.venta.count(),
    bodegas: await prisma.bodega.count(),
    inventario: await prisma.inventario.count(),
    pedidosProduccion: await prisma.pedidoProduccion.count(),
    usuarios: await prisma.usuario.count(),
    roles: await prisma.rol.count(),
    permisos: await prisma.permiso.count(),
    alertas: await prisma.alertaInterna.count(),
  };

  console.log('\nSeed completado con exito.');
  console.log('Usuario demo: admin@uniforma.local');
  console.log('Password demo: Admin123*');
  console.log(JSON.stringify(resumen, null, 2));
}

main()
  .catch((error) => {
    console.error('Error al sembrar datos demo:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
