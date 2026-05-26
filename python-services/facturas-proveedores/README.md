# Facturas proveedores scanner

Microservicio opcional para leer facturas PDF de proveedores.

## Ejecutar local

```bash
py -m pip install -r requirements.txt
py -m uvicorn app:app --host 0.0.0.0 --port 8001
```

Luego configura el backend:

```env
PYTHON_INVOICE_SCANNER_URL=http://localhost:8001
```

El backend funciona aunque esta variable no exista, pero en ese caso solo guarda el PDF y deja los campos para edición manual.
