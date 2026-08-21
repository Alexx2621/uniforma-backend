"""Conserva el .htaccess de cPanel y bloquea el Socket.IO antiguo en Apache."""

from pathlib import Path
import sys


INICIO = "# BEGIN UNIFORMA REALTIME EXTERNO"
FIN = "# END UNIFORMA REALTIME EXTERNO"
BLOQUE = f"""{INICIO}
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^socket\\.io/ - [G,L,NC]
</IfModule>
{FIN}"""


def actualizar(ruta: Path) -> None:
    contenido = ruta.read_text(encoding="utf-8") if ruta.exists() else ""
    if INICIO in contenido and FIN in contenido:
        antes, resto = contenido.split(INICIO, 1)
        _, despues = resto.split(FIN, 1)
        contenido = f"{antes.rstrip()}\n\n{despues.lstrip()}"

    ruta.write_text(f"{BLOQUE}\n\n{contenido.lstrip()}", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: configurar-cpanel-htaccess.py <archivo>")
    actualizar(Path(sys.argv[1]))
