-- Drop unused columns for inventario ingreso simplificado
ALTER TABLE IngresoInventario DROP COLUMN proveedor;
ALTER TABLE IngresoInventario DROP COLUMN factura;
ALTER TABLE DetalleIngreso DROP COLUMN costoUnit;
