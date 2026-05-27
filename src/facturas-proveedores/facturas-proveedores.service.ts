import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../prisma.service';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const cleanText = (value: unknown) => {
  const text = `${value ?? ''}`.trim();
  return text || null;
};

const normalizeText = (value: unknown) =>
  `${value ?? ''}`
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const normalizeNit = (value: unknown) => `${value ?? ''}`.replace(/[^0-9Kk]/g, '').toUpperCase();

const toNumber = (value: unknown) => {
  if (value === null || typeof value === 'undefined' || value === '') return 0;
  const normalized = `${value}`.replace(/[Q,$\s]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDate = (value: unknown) => {
  const text = cleanText(value);
  if (!text) return null;
  const date = DATE_ONLY_RE.test(text) ? new Date(`${text}T00:00:00.000Z`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateRange = (desde?: string, hasta?: string) => {
  const where: any = {};
  const start = toDate(desde);
  const end = toDate(hasta);
  if (start) where.gte = start;
  if (end) {
    end.setUTCHours(23, 59, 59, 999);
    where.lte = end;
  }
  return Object.keys(where).length ? where : undefined;
};

@Injectable()
export class FacturasProveedoresService {
  constructor(private prisma: PrismaService) {}

  private facturaSelect = {
    id: true,
    proveedorId: true,
    proveedorNombre: true,
    proveedorNit: true,
    numeroFactura: true,
    serie: true,
    numeroAutorizacion: true,
    numeroAcceso: true,
    numeroCertificacion: true,
    tipoDocumento: true,
    condicionPago: true,
    receptorNombre: true,
    receptorNit: true,
    receptorDireccion: true,
    certificadorNombre: true,
    certificadorNit: true,
    fechaFactura: true,
    fechaCertificacion: true,
    fechaVencimiento: true,
    fechaRegistro: true,
    moneda: true,
    subtotal: true,
    impuestos: true,
    total: true,
    estado: true,
    metodoPago: true,
    referenciaPago: true,
    tipoGasto: true,
    descripcion: true,
    observaciones: true,
    archivoNombre: true,
    archivoMime: true,
    confianza: true,
    creadoEn: true,
    actualizadoEn: true,
    proveedor: { select: { id: true, nombre: true, nit: true } },
    detalle: {
      orderBy: { linea: 'asc' as const },
      select: {
        id: true,
        linea: true,
        cantidad: true,
        unidad: true,
        tipo: true,
        descripcion: true,
        precioUnitario: true,
        descuento: true,
        impuestoNombre: true,
        impuestoMonto: true,
        total: true,
      },
    },
  };

  private normalizePayload(body: any = {}, partial = false) {
    const data: any = {};
    const textFields = [
      'proveedorNombre',
      'proveedorNit',
      'numeroFactura',
      'serie',
      'numeroAutorizacion',
      'numeroAcceso',
      'numeroCertificacion',
      'tipoDocumento',
      'condicionPago',
      'receptorNombre',
      'receptorNit',
      'receptorDireccion',
      'certificadorNombre',
      'certificadorNit',
      'moneda',
      'estado',
      'metodoPago',
      'referenciaPago',
      'tipoGasto',
      'descripcion',
      'observaciones',
    ];

    if (!partial || body.proveedorId !== undefined) {
      const proveedorId = Number(body.proveedorId || 0);
      data.proveedorId = Number.isInteger(proveedorId) && proveedorId > 0 ? proveedorId : null;
    }
    for (const field of textFields) {
      if (!partial || body[field] !== undefined) data[field] = cleanText(body[field]);
    }
    if (!data.moneda && (!partial || body.moneda !== undefined)) data.moneda = 'GTQ';
    if (!data.estado && (!partial || body.estado !== undefined)) data.estado = 'pendiente';
    if (!partial || body.fechaFactura !== undefined) data.fechaFactura = toDate(body.fechaFactura);
    if (!partial || body.fechaCertificacion !== undefined) data.fechaCertificacion = toDate(body.fechaCertificacion);
    if (!partial || body.fechaVencimiento !== undefined) data.fechaVencimiento = toDate(body.fechaVencimiento);
    if (!partial || body.subtotal !== undefined) data.subtotal = toNumber(body.subtotal);
    if (!partial || body.impuestos !== undefined) data.impuestos = toNumber(body.impuestos);
    if (!partial || body.total !== undefined) data.total = toNumber(body.total);
    return data;
  }

  private normalizeDetalle(body: any = {}) {
    const rows = Array.isArray(body.detalle) ? body.detalle : Array.isArray(body.items) ? body.items : [];
    return rows
      .map((item: any, index: number) => ({
        linea: Number(item?.linea || index + 1),
        cantidad: toNumber(item?.cantidad),
        unidad: cleanText(item?.unidad),
        tipo: cleanText(item?.tipo),
        descripcion: cleanText(item?.descripcion) || 'Sin descripcion',
        precioUnitario: toNumber(item?.precioUnitario),
        descuento: toNumber(item?.descuento),
        impuestoNombre: cleanText(item?.impuestoNombre || item?.impuesto),
        impuestoMonto: toNumber(item?.impuestoMonto),
        total: toNumber(item?.total),
        datosExtraidos: item?.datosExtraidos || item || undefined,
      }))
      .filter((item) => item.descripcion !== 'Sin descripcion' || item.total > 0 || item.cantidad > 0);
  }

  private async resolveProveedorParaCarga(body: any = {}, extracted: any = {}) {
    const proveedorId = Number(body.proveedorId || 0);
    const proveedorNit = cleanText(extracted.proveedorNit);
    const proveedorNombre = cleanText(extracted.proveedorNombre);
    const detectedNit = normalizeNit(proveedorNit);
    const detectedName = normalizeText(proveedorNombre);

    if (Number.isInteger(proveedorId) && proveedorId > 0) {
      const proveedor = await this.prisma.proveedor.findUnique({ where: { id: proveedorId } });
      if (!proveedor) {
        throw new BadRequestException({
          code: 'PROVEEDOR_NO_EXISTE',
          message: 'El proveedor seleccionado no existe. Crea o selecciona un proveedor valido antes de cargar la factura.',
          proveedorNombre,
          proveedorNit,
        });
      }
      if (`${proveedor.estado || ''}`.trim().toLowerCase() !== 'activo') {
        throw new BadRequestException({
          code: 'PROVEEDOR_INACTIVO',
          message: `El proveedor ${proveedor.nombre} no esta activo. Activalo antes de cargar facturas.`,
          proveedorNombre: proveedor.nombre,
          proveedorNit: proveedor.nit,
        });
      }
      const selectedNit = normalizeNit(proveedor.nit);
      if (detectedNit && selectedNit && detectedNit !== selectedNit) {
        throw new BadRequestException({
          code: 'PROVEEDOR_NO_COINCIDE',
          message: `La factura pertenece al NIT ${proveedorNit}, pero seleccionaste ${proveedor.nombre}${proveedor.nit ? ` (${proveedor.nit})` : ''}.`,
          proveedorNombre,
          proveedorNit,
        });
      }
      const selectedNames = [proveedor.nombre, proveedor.razonSocial]
        .map((value) => normalizeText(value))
        .filter(Boolean);
      const nameMatches = Boolean(
        detectedName &&
          selectedNames.some((selectedName) => detectedName.includes(selectedName) || selectedName.includes(detectedName)),
      );
      if ((!detectedNit || !selectedNit) && detectedName && selectedNames.length && !nameMatches) {
        throw new BadRequestException({
          code: 'PROVEEDOR_NO_COINCIDE',
          message: `La factura parece pertenecer a ${proveedorNombre}, pero seleccionaste ${proveedor.nombre}.`,
          proveedorNombre,
          proveedorNit,
        });
      }
      if (detectedNit && !selectedNit && !nameMatches) {
        throw new BadRequestException({
          code: 'PROVEEDOR_SIN_NIT',
          message: `La factura trae el NIT ${proveedorNit}, pero el proveedor seleccionado no tiene NIT guardado o no coincide por nombre. Actualiza el proveedor antes de cargar la factura.`,
          proveedorNombre,
          proveedorNit,
        });
      }
      return proveedor;
    }

    if (detectedNit) {
      const candidates = await this.prisma.proveedor.findMany({
        where: {
          nit: { contains: proveedorNit || detectedNit },
        },
      });
      const proveedor = candidates.find((item) => normalizeNit(item.nit) === detectedNit);
      if (proveedor) {
        if (`${proveedor.estado || ''}`.trim().toLowerCase() !== 'activo') {
          throw new BadRequestException({
            code: 'PROVEEDOR_INACTIVO',
            message: `El proveedor ${proveedor.nombre} existe, pero no esta activo. Activalo antes de cargar facturas.`,
            proveedorNombre: proveedor.nombre,
            proveedorNit: proveedor.nit,
          });
        }
        return proveedor;
      }
    }

    if (proveedorNombre) {
      const candidates = await this.prisma.proveedor.findMany({
        where: { nombre: { contains: proveedorNombre } },
      });
      const proveedor = candidates.find((item) => {
        const candidateName = normalizeText(item.nombre);
        return detectedName.includes(candidateName) || candidateName.includes(detectedName);
      });
      if (proveedor) {
        if (`${proveedor.estado || ''}`.trim().toLowerCase() !== 'activo') {
          throw new BadRequestException({
            code: 'PROVEEDOR_INACTIVO',
            message: `El proveedor ${proveedor.nombre} existe, pero no esta activo. Activalo antes de cargar facturas.`,
            proveedorNombre: proveedor.nombre,
            proveedorNit: proveedor.nit,
          });
        }
        return proveedor;
      }
    }

    throw new BadRequestException({
      code: 'PROVEEDOR_NO_EXISTE',
      message: proveedorNombre || proveedorNit
        ? `El proveedor ${proveedorNombre || proveedorNit} no existe en el catalogo. Crealo antes de cargar esta factura.`
        : 'No se pudo identificar un proveedor existente. Selecciona un proveedor o crealo antes de cargar la factura.',
      proveedorNombre,
      proveedorNit,
    });
  }

  async findAll(query: { q?: string; estado?: string; proveedorId?: string; desde?: string; hasta?: string } = {}) {
    const where: any = {};
    const q = cleanText(query.q);
    if (q) {
      where.OR = [
        { proveedorNombre: { contains: q } },
        { proveedorNit: { contains: q } },
        { numeroFactura: { contains: q } },
        { serie: { contains: q } },
        { descripcion: { contains: q } },
        { proveedor: { nombre: { contains: q } } },
      ];
    }
    if (query.estado) where.estado = query.estado;
    const proveedorId = Number(query.proveedorId || 0);
    if (Number.isInteger(proveedorId) && proveedorId > 0) where.proveedorId = proveedorId;
    const fechaFactura = dateRange(query.desde, query.hasta);
    if (fechaFactura) where.fechaFactura = fechaFactura;

    return this.prisma.facturaProveedor.findMany({
      where,
      select: this.facturaSelect,
      orderBy: [{ fechaFactura: 'desc' }, { id: 'desc' }],
    });
  }

  async findOne(id: number) {
    const row = await this.prisma.facturaProveedor.findUnique({ where: { id }, select: this.facturaSelect });
    if (!row) throw new NotFoundException('Factura de proveedor no encontrada');
    return row;
  }

  async create(body: any) {
    const data = await this.completeProveedorData(this.normalizePayload(body));
    const detalle = this.normalizeDetalle(body);
    return this.prisma.facturaProveedor.create({
      data: {
        ...data,
        detalle: detalle.length ? { create: detalle } : undefined,
      },
      select: this.facturaSelect,
    });
  }

  async uploadPdf(file: { originalname: string; mimetype: string; buffer: Buffer }, body: any = {}) {
    if (!file?.buffer?.length) throw new BadRequestException('Debes cargar un PDF');
    const scan = await this.scanPdf(file);
    const extracted = scan?.data || scan || {};
    const confidence = toNumber(extracted.confianza || extracted.confidence || 0);
    const hasUsefulData = Boolean(
      extracted.proveedorNombre ||
        extracted.proveedorNit ||
        extracted.numeroFactura ||
        extracted.serie ||
        extracted.fechaFactura ||
        toNumber(extracted.total) > 0,
    );
    if (!hasUsefulData || confidence <= 0) {
      throw new BadRequestException(
        'No se pudo leer la factura automaticamente. Verifica que Python tenga pypdf instalado o configura PYTHON_INVOICE_SCANNER_URL.',
      );
    }
    const proveedor = await this.resolveProveedorParaCarga(body, extracted);
    const normalized = this.normalizePayload({
      ...extracted,
      ...body,
      proveedorId: proveedor.id,
      proveedorNombre: proveedor.nombre,
      proveedorNit: proveedor.nit || extracted.proveedorNit,
    });
    const data = await this.completeProveedorData({
      ...normalized,
      archivoNombre: file.originalname,
      archivoMime: file.mimetype,
      textoExtraido: cleanText(extracted.textoExtraido || extracted.rawText || ''),
      datosExtraidos: extracted,
      confianza: confidence,
    });

    const detalle = this.normalizeDetalle(extracted);
    return this.prisma.$transaction(async (tx) => {
      const factura = await tx.facturaProveedor.create({
        data: {
          ...data,
          detalle: detalle.length ? { create: detalle } : undefined,
        },
        select: this.facturaSelect,
      });
      if (this.esFacturaTela(proveedor, data, detalle)) {
        await this.crearIngresoTelaDesdeFactura(tx, factura.id);
      }
      return factura;
    });
  }

  async update(id: number, body: any) {
    await this.findOne(id);
    const data = await this.completeProveedorData(this.normalizePayload(body, true));
    const shouldReplaceDetalle = body.detalle !== undefined || body.items !== undefined;
    const detalle = this.normalizeDetalle(body);
    if (!shouldReplaceDetalle) {
      return this.prisma.facturaProveedor.update({ where: { id }, data, select: this.facturaSelect });
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.facturaProveedorDetalle.deleteMany({ where: { facturaId: id } });
      return tx.facturaProveedor.update({
        where: { id },
        data: {
          ...data,
          detalle: detalle.length ? { create: detalle } : undefined,
        },
        select: this.facturaSelect,
      });
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.facturaProveedor.delete({ where: { id } });
  }

  async getPdf(id: number) {
    const factura = await this.prisma.facturaProveedor.findUnique({ where: { id } });
    if (!factura) throw new NotFoundException('Factura de proveedor no encontrada');
    if (!factura.archivoBase64) throw new NotFoundException('La factura no tiene PDF adjunto');
    return {
      name: factura.archivoNombre || `factura-proveedor-${id}.pdf`,
      mime: factura.archivoMime || 'application/pdf',
      buffer: Buffer.from(factura.archivoBase64, 'base64'),
    };
  }

  private async completeProveedorData(data: any) {
    if (data.proveedorId) {
      const proveedor = await this.prisma.proveedor.findUnique({ where: { id: Number(data.proveedorId) } });
      if (proveedor) {
        data.proveedorNombre = data.proveedorNombre || proveedor.nombre;
        data.proveedorNit = data.proveedorNit || proveedor.nit;
      }
    }
    if (!data.proveedorId && data.proveedorNit) {
      const proveedor = await this.prisma.proveedor.findFirst({ where: { nit: data.proveedorNit } });
      if (proveedor) data.proveedorId = proveedor.id;
    }
    if (!data.proveedorId && data.proveedorNombre) {
      const proveedor = await this.prisma.proveedor.findFirst({ where: { nombre: { contains: data.proveedorNombre } } });
      if (proveedor) data.proveedorId = proveedor.id;
    }
    return data;
  }

  private esFacturaTela(proveedor: any, data: any, detalle: any[]) {
    const tipoProveedor = normalizeText(proveedor?.tipo);
    const tipoGasto = normalizeText(data?.tipoGasto);
    return tipoProveedor.includes('tela') || tipoGasto.includes('tela') || detalle.some((item) => /tela|swan|repel|oxford|novak|silk/i.test(item.descripcion || ''));
  }

  private extraerDatosTelaProveedor(descripcion: string) {
    const text = `${descripcion || ''}`.replace(/\s+/g, ' ').trim();
    const codeMatch = text.match(/(?:#\s*)?([0-9]{2,}[A-Z0-9-]*|[A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]*)\b/i);
    const codigo = codeMatch?.[1] || null;
    const beforeCode = codigo ? text.slice(0, text.indexOf(codigo)).trim() : text;
    const nombre = beforeCode.replace(/#?\s*$/, '').replace(/[\/-]\s*$/, '').trim() || text;
    const afterCode = codigo ? text.slice(text.indexOf(codigo) + codigo.length).replace(/^[@#\s-]+/, '').trim() : '';
    const color = afterCode
      .replace(/@.*$/g, '')
      .replace(/\b\d+(?:\.\d+)?$/g, '')
      .replace(/[,\-/\s]+$/g, '')
      .trim() || null;
    const lote = text.match(/@([A-Z0-9-]+)/i)?.[1] || null;
    return { codigo, nombre, color, lote };
  }

  private async buscarTelaMatch(tx: any, proveedorId: number | null, descripcion: string) {
    const parsed = this.extraerDatosTelaProveedor(descripcion);
    const normalizedDesc = normalizeText(descripcion);
    if (proveedorId) {
      const aliases = await tx.telaProveedorAlias.findMany({
        where: { proveedorId, activo: true },
        include: { tela: true, color: true },
      });
      const alias = aliases.find((item: any) => {
        const codigo = normalizeText(item.codigoProveedor);
        const nombre = normalizeText(item.nombreProveedor);
        const color = normalizeText(item.colorProveedor);
        const matchCodigo = codigo && normalizedDesc.includes(codigo);
        const matchNombre = nombre && normalizedDesc.includes(nombre);
        const matchColor = !color || normalizedDesc.includes(color);
        return (matchCodigo || matchNombre) && matchColor;
      });
      if (alias) {
        const colorId = alias.colorId || (await this.buscarColorMatch(tx, proveedorId, descripcion, alias.colorProveedor || parsed.color));
        return {
          telaId: alias.telaId,
          colorId,
          unidad: alias.unidad || 'metros',
          ancho: Number(alias.ancho || 0),
          parsed: {
            codigo: parsed.codigo || alias.codigoProveedor,
            nombre: alias.nombreProveedor || parsed.nombre,
            color: alias.colorProveedor || parsed.color,
            lote: parsed.lote,
          },
        };
      }
    }
    const colorId = proveedorId ? await this.buscarColorMatch(tx, proveedorId, descripcion, parsed.color) : null;
    const telas = await tx.tela.findMany();
    const tela = telas.find((item: any) => {
      const nombre = normalizeText(item.nombre);
      return nombre && (normalizedDesc.includes(nombre) || nombre.includes(normalizeText(parsed.nombre)));
    });
    return { telaId: tela?.id || null, colorId, unidad: 'metros', ancho: 0, parsed };
  }

  private async buscarColorMatch(tx: any, proveedorId: number, descripcion: string, colorProveedor?: string | null) {
    const normalizedDesc = normalizeText(descripcion);
    const normalizedColor = normalizeText(colorProveedor);
    const aliases = await tx.colorProveedorAlias.findMany({
      where: { proveedorId, activo: true },
      include: { color: true },
    });
    const alias = aliases.find((item: any) => {
      const codigo = normalizeText(item.codigoProveedor);
      const nombre = normalizeText(item.nombreProveedor);
      return (
        (codigo && (normalizedDesc.includes(codigo) || codigo === normalizedColor)) ||
        (nombre && (normalizedDesc.includes(nombre) || nombre === normalizedColor))
      );
    });
    if (alias) return alias.colorId;
    const colores = await tx.color.findMany();
    const color = colores.find((item: any) => {
      const nombre = normalizeText(item.nombre);
      return nombre && (normalizedDesc.includes(nombre) || nombre === normalizedColor);
    });
    return color?.id || null;
  }

  private async crearIngresoTelaDesdeFactura(tx: any, facturaId: number) {
    const factura = await tx.facturaProveedor.findUnique({
      where: { id: facturaId },
      include: { detalle: true, proveedor: true },
    });
    if (!factura || !factura.detalle.length) return null;
    const exists = await tx.ingresoTela.findFirst({ where: { facturaProveedorId: factura.id } });
    if (exists) return exists;
    const count = await tx.ingresoTela.count();
    const correlativo = `IT-${String(count + 1).padStart(5, '0')}`;
    const detalles: any[] = [];
    for (const item of factura.detalle) {
      const match = await this.buscarTelaMatch(tx, factura.proveedorId, item.descripcion);
      const costoUnitario = Number(item.precioUnitario || 0) || (Number(item.total || 0) / Math.max(Number(item.cantidad || 0), 1));
      detalles.push({
        facturaProveedorDetalleId: item.id,
        linea: item.linea,
        telaId: match.telaId,
        colorId: match.colorId,
        proveedorCodigo: match.parsed.codigo,
        proveedorNombre: match.parsed.nombre,
        descripcionFactura: item.descripcion,
        cantidad: Number(item.cantidad || 0),
        unidad: match.unidad || 'metros',
        costoUnitario,
        total: Number(item.total || 0),
        lote: match.parsed.lote,
        tono: match.parsed.color,
        ancho: Number(match.ancho || 0),
        estado: match.telaId ? 'pendiente' : 'pendiente',
      });
    }
    return tx.ingresoTela.create({
      data: {
        correlativo,
        facturaProveedorId: factura.id,
        proveedorId: factura.proveedorId,
        documentoTipo: 'factura',
        documentoReferencia: `${factura.serie || ''}-${factura.numeroFactura || factura.id}`.replace(/^-|-$/g, ''),
        documentoTotal: Number(factura.total || 0),
        fecha: factura.fechaFactura || new Date(),
        estado: 'abierto',
        observaciones: `Generado desde factura ${factura.serie || ''}-${factura.numeroFactura || factura.id}`.trim(),
        detalle: { create: detalles },
      },
    });
  }

  private async scanPdf(file: { originalname: string; mimetype: string; buffer: Buffer }) {
    const url = cleanText(process.env.PYTHON_INVOICE_SCANNER_URL);
    if (!url) {
      return this.scanPdfLocal(file);
    }

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer) as any], { type: file.mimetype }), file.originalname);
    const resp = await fetch(`${url.replace(/\/$/, '')}/scan-invoice`, {
      method: 'POST',
      body: form as any,
    });
    if (!resp.ok) throw new BadRequestException(`El lector de facturas respondio ${resp.status}`);
    return resp.json();
  }

  private async scanPdfLocal(file: { originalname: string; buffer: Buffer }) {
    const scriptPath = join(process.cwd(), 'python-services', 'facturas-proveedores', 'app.py');
    const tempPath = join(tmpdir(), `factura-proveedor-${randomUUID()}.pdf`);
    await fs.writeFile(tempPath, file.buffer);
    try {
      const commands = [cleanText(process.env.PYTHON_BINARY), 'py', 'python', 'python3'].filter(Boolean) as string[];
      let lastError = '';
      for (const command of commands) {
        const result = await this.runPythonScanner(command, scriptPath, tempPath);
        if (result.ok) return JSON.parse(result.stdout);
        lastError = result.stderr || result.stdout || `No se pudo ejecutar ${command}`;
      }
      throw new BadRequestException(
        `No se pudo ejecutar el lector Python local. Verifica que el servidor tenga Python y dependencias instaladas, o configura PYTHON_INVOICE_SCANNER_URL. Detalle: ${lastError}`,
      );
    } finally {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  }

  private runPythonScanner(command: string, scriptPath: string, pdfPath: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, [scriptPath, '--scan', pdfPath], { windowsHide: true });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      proc.on('error', (error) => {
        resolve({ ok: false, stdout, stderr: error.message });
      });
      proc.on('close', (code) => {
        resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  }
}
