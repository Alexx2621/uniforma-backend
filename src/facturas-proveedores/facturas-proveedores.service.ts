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
    fechaFactura: true,
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
  };

  private normalizePayload(body: any = {}, partial = false) {
    const data: any = {};
    const textFields = [
      'proveedorNombre',
      'proveedorNit',
      'numeroFactura',
      'serie',
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
    if (!partial || body.fechaVencimiento !== undefined) data.fechaVencimiento = toDate(body.fechaVencimiento);
    if (!partial || body.subtotal !== undefined) data.subtotal = toNumber(body.subtotal);
    if (!partial || body.impuestos !== undefined) data.impuestos = toNumber(body.impuestos);
    if (!partial || body.total !== undefined) data.total = toNumber(body.total);
    return data;
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
    return this.prisma.facturaProveedor.create({ data, select: this.facturaSelect });
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
    const normalized = this.normalizePayload({ ...extracted, ...body });
    const data = await this.completeProveedorData({
      ...normalized,
      archivoNombre: file.originalname,
      archivoMime: file.mimetype,
      textoExtraido: cleanText(extracted.textoExtraido || extracted.rawText || ''),
      datosExtraidos: extracted,
      confianza: confidence,
    });

    return this.prisma.facturaProveedor.create({ data, select: this.facturaSelect });
  }

  async update(id: number, body: any) {
    await this.findOne(id);
    const data = await this.completeProveedorData(this.normalizePayload(body, true));
    return this.prisma.facturaProveedor.update({ where: { id }, data, select: this.facturaSelect });
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
      throw new BadRequestException(`No se pudo ejecutar el lector Python local. ${lastError}`);
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
