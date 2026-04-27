export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  category: string;
}

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  { key: 'dashboard.view', label: 'Dashboard', description: 'Ver dashboard principal', category: 'General' },
  { key: 'ventas.view', label: 'Ventas', description: 'Ver modulo de ventas', category: 'Ventas' },
  { key: 'ventas.manage', label: 'Gestionar ventas', description: 'Crear y operar ventas', category: 'Ventas' },
  { key: 'cotizaciones.view', label: 'Cotizaciones', description: 'Ver modulo de cotizaciones', category: 'Ventas' },
  { key: 'cotizaciones.manage', label: 'Gestionar cotizaciones', description: 'Crear y operar cotizaciones', category: 'Ventas' },
  { key: 'productos.view', label: 'Productos', description: 'Ver productos', category: 'Productos' },
  { key: 'productos.manage', label: 'Gestionar productos', description: 'Crear, editar y eliminar productos', category: 'Productos' },
  { key: 'inventario.ingreso.view', label: 'Ingreso inventario', description: 'Ver ingresos de inventario', category: 'Inventario' },
  { key: 'inventario.resumen.view', label: 'Resumen inventario', description: 'Ver resumen de inventario', category: 'Inventario' },
  { key: 'inventario.traslados.view', label: 'Traslados', description: 'Ver traslados de inventario', category: 'Inventario' },
  { key: 'bodegas.view', label: 'Bodegas', description: 'Ver modulo de bodegas', category: 'Gestion' },
  { key: 'bodegas.manage', label: 'Gestionar bodegas', description: 'Crear, editar y eliminar bodegas', category: 'Gestion' },
  { key: 'produccion.view', label: 'Produccion', description: 'Ver pedidos de produccion', category: 'Produccion' },
  { key: 'produccion.manage', label: 'Gestionar produccion', description: 'Crear y operar pedidos de produccion', category: 'Produccion' },
  { key: 'pagos.view', label: 'Pagos', description: 'Ver modulo de pagos', category: 'Pagos' },
  { key: 'pagos.manage', label: 'Gestionar pagos', description: 'Crear y operar pagos', category: 'Pagos' },
  { key: 'clientes.view', label: 'Clientes', description: 'Ver clientes', category: 'Gestion' },
  { key: 'clientes.manage', label: 'Gestionar clientes', description: 'Crear, editar y eliminar clientes', category: 'Gestion' },
  { key: 'usuarios.view', label: 'Usuarios', description: 'Ver usuarios', category: 'Gestion' },
  { key: 'usuarios.manage', label: 'Gestionar usuarios', description: 'Crear, editar y eliminar usuarios', category: 'Gestion' },
  { key: 'roles.view', label: 'Roles', description: 'Ver panel de roles', category: 'Gestion' },
  { key: 'roles.manage', label: 'Gestionar roles', description: 'Crear, editar y eliminar roles', category: 'Gestion' },
  { key: 'correlativos.view', label: 'Correlativos', description: 'Ver panel de correlativos', category: 'Gestion' },
  {
    key: 'correlativos.manage',
    label: 'Gestionar correlativos',
    description: 'Modificar abreviaturas y contadores de correlativos',
    category: 'Gestion',
  },
  { key: 'admin.view', label: 'Configuracion', description: 'Ver panel de configuracion', category: 'Gestion' },
  { key: 'admin.manage', label: 'Gestionar configuracion', description: 'Modificar configuraciones del sistema', category: 'Gestion' },
  { key: 'reportes.ventas-diarias.view', label: 'Ventas diarias', description: 'Ver reporte de ventas diarias', category: 'Reportes' },
  { key: 'reportes.reporte-diario.view', label: 'Reporte diario', description: 'Ver reporte diario', category: 'Reportes' },
  { key: 'reportes.reporte-quincenal.view', label: 'Reporte quincenal', description: 'Ver reporte quincenal', category: 'Reportes' },
  {
    key: 'reportes.ventas-producto.view',
    label: 'Ventas por producto',
    description: 'Ver reporte de ventas por producto',
    category: 'Reportes',
  },
  { key: 'reportes.top-clientes.view', label: 'Top clientes', description: 'Ver reporte de top clientes', category: 'Reportes' },
  {
    key: 'reportes.ingresos.view',
    label: 'Ingresos de inventario',
    description: 'Ver reporte de ingresos de inventario',
    category: 'Reportes',
  },
  { key: 'reportes.traslados.view', label: 'Reporte de traslados', description: 'Ver reporte de traslados', category: 'Reportes' },
  { key: 'reportes.stock-bajo.view', label: 'Stock bajo', description: 'Ver reporte de stock bajo', category: 'Reportes' },
];
