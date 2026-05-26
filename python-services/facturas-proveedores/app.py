import io
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from pypdf import PdfReader

try:
    from fastapi import FastAPI, File, UploadFile
except ImportError:
    FastAPI = None
    File = None
    UploadFile = None

app = FastAPI(title="Uniforma Facturas Proveedores Scanner") if FastAPI else None


def clean(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def parse_money(value: str | None) -> float:
    if not value:
        return 0.0
    text = re.sub(r"[Q$,\s]", "", value)
    try:
        return float(text)
    except ValueError:
        return 0.0


def parse_date(value: str | None) -> str | None:
    if not value:
        return None
    months = {
        "ene": "01",
        "feb": "02",
        "mar": "03",
        "abr": "04",
        "may": "05",
        "jun": "06",
        "jul": "07",
        "ago": "08",
        "sep": "09",
        "oct": "10",
        "nov": "11",
        "dic": "12",
    }
    month_match = re.search(r"(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})", value.strip(), flags=re.IGNORECASE)
    if month_match:
        day, month_name, year = month_match.groups()
        month = months.get(month_name.lower()[:3])
        if month:
            return f"{year}-{month}-{int(day):02d}"
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def first_match(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            return clean(match.group(1))
    return None


def extract_text(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    chunks = []
    for page in reader.pages:
        chunks.append(page.extract_text() or "")
    return "\n".join(chunks)


def scan_text(text: str) -> dict[str, Any]:
    normalized = re.sub(r"[ \t]+", " ", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    nit = first_match(
        [
            r"Nit\s+Emisor\s*:\s*([0-9Kk\-]+)",
            r"NIT\s+Emisor\s*:\s*([0-9Kk\-]+)",
            r"(?:NIT|N\.I\.T\.?)\s*[:#-]?\s*([0-9Kk\-]+)",
            r"([0-9]{5,10}-?[0-9Kk])\s+(?:FACTURA|SERIE)",
        ],
        normalized,
    )
    numero = first_match(
        [
            r"N[uú]mero\s+de\s+DTE\s*:\s*([A-Z0-9\-]+)",
            r"Numero\s+de\s+DTE\s*:\s*([A-Z0-9\-]+)",
            r"(?:FACTURA|DOCUMENTO|DTE|No\.?|NUMERO|N[uú]mero)\s*[:#-]?\s*([A-Z0-9\-]+)",
            r"(?:No\.\s*Factura)\s*[:#-]?\s*([A-Z0-9\-]+)",
        ],
        normalized,
    )
    serie = first_match([r"SERIE\s*[:#-]?\s*([A-Z0-9\-]+)", r"Serie\s*:\s*([A-Z0-9\-]+)"], normalized)
    fecha = parse_date(
        first_match(
            [
                r"Fecha\s+y\s+hora\s+de\s+emision\s*:\s*([0-9]{1,2}[-/ ][A-Za-z]{3}[-/ ][0-9]{4})",
                r"Fecha\s+y\s+hora\s+de\s+emisi[oó]n\s*:\s*([0-9]{1,2}[-/ ][A-Za-z]{3}[-/ ][0-9]{4})",
                r"(?:FECHA\s*(?:DE\s*EMISI[OÓ]N)?|EMISI[OÓ]N)\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
                r"(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
            ],
            normalized,
        )
    )

    for idx, line in enumerate(lines):
        upper = line.upper()
        if upper == "SERIE:" and idx >= 3:
            serie = clean(lines[idx - 3])
            numero = clean(lines[idx - 2])
            fecha = fecha or parse_date(lines[idx - 1])
            break
    fecha_vencimiento = parse_date(
        first_match(
            [
                r"Fecha\s*Vencimiento\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
                r"VENCIMIENTO\s*[:#-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
            ],
            normalized,
        )
    )

    supplier_nit_idx = None
    for idx, line in enumerate(lines):
        upper = line.upper()
        if upper.startswith("NIT:") or upper.startswith("NIT EMISOR:") or upper.startswith("NIT EMISOR"):
            candidate = clean(re.sub(r"^NIT\s*(?:EMISOR)?\s*:\s*", "", line, flags=re.IGNORECASE))
            if candidate and " " in candidate:
                candidate = candidate.split()[0]
            if candidate and idx > 0:
                supplier_nit_idx = idx
                nit = nit or candidate
                break
        if "NIT EMISOR:" in upper or "NIT EMISOR" in upper:
            candidate = first_match([r"Nit\s+Emisor\s*:\s*([0-9Kk\-]+)"], line)
            if candidate and idx > 0:
                supplier_nit_idx = idx
                nit = nit or candidate
                break

    money_values = [parse_money(match) for match in re.findall(r"Q\.?\s*([0-9,]+\.\d{2})", normalized)]
    total_from_totales = parse_money(
        first_match(
            [
                r"TOTALES\s*:\s*[0-9,]+\.\d{2}\s+([0-9,]+\.\d{2})\s+IVA",
                r"TOTALES\s*:\s*[0-9,]+\.\d{2}\s+([0-9,]+\.\d{2})",
            ],
            normalized,
        )
    )
    total = total_from_totales or (max(money_values) if money_values else parse_money(
        first_match(
            [
                r"(?:TOTAL\s*A\s*PAGAR|GRAN\s*TOTAL|TOTAL)\s*[:#-]?\s*Q?\.?\s*([0-9,]+\.\d{2})",
            ],
            normalized,
        )
    ))
    iva_values = [parse_money(match) for match in re.findall(r"IVA:\s*([0-9,]+\.\d{2})", normalized, flags=re.IGNORECASE)]
    impuestos = round(sum(iva_values), 2) if iva_values else round(parse_money(first_match([r"(?:IVA|IMPUESTO\S*)\s*[:#-]?\s*Q?\.?\s*([0-9,]+\.\d+)"], normalized)), 2)
    subtotal = parse_money(first_match([r"(?:SUBTOTAL|SUB\s*TOTAL)\s*[:#-]?\s*Q?\s*([0-9,]+\.\d{2})"], normalized))
    if subtotal == 0 and total > 0 and impuestos > 0:
        subtotal = round(total - impuestos, 2)

    proveedor = None
    if supplier_nit_idx and supplier_nit_idx > 0:
        proveedor = lines[supplier_nit_idx - 1][:190]
        proveedor = re.sub(r"\s*N[UÚ]MERO\s+DE\s+AUTORIZACI[OÓ]N\s*:?\s*$", "", proveedor, flags=re.IGNORECASE).strip()
    if not proveedor:
        for line in lines[:30]:
            upper = line.upper()
            if "FACTURA" not in upper and "NIT" not in upper and "CANTIDAD" not in upper and len(line) > 3:
                proveedor = line[:190]
                break

    confidence = 0.0
    for value in [proveedor, nit, numero, fecha, total]:
        if value:
            confidence += 0.2

    return {
        "proveedorNombre": proveedor,
        "proveedorNit": nit,
        "numeroFactura": numero,
        "serie": serie,
        "fechaFactura": fecha,
        "fechaVencimiento": fecha_vencimiento,
        "moneda": "GTQ",
        "subtotal": subtotal,
        "impuestos": impuestos,
        "total": total,
        "estado": "pendiente",
        "confianza": round(confidence, 2),
        "textoExtraido": text,
    }


if app:
    @app.get("/health")
    def health():
        return {"ok": True}


    @app.post("/scan-invoice")
    async def scan_invoice(file: UploadFile = File(...)):
        pdf_bytes = await file.read()
        text = extract_text(pdf_bytes)
        data = scan_text(text)
        data["archivoNombre"] = file.filename
        return {"data": data}


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--scan":
        pdf_path = Path(sys.argv[2])
        data = scan_text(extract_text(pdf_path.read_bytes()))
        data["archivoNombre"] = pdf_path.name
        print(json.dumps({"data": data}, ensure_ascii=False))
    else:
        print("Uso: py app.py --scan factura.pdf", file=sys.stderr)
        raise SystemExit(2)
