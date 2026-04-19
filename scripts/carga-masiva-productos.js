require("dotenv/config");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const TIPOS = [
  { nombre: "FILIPINA", abreviacion: "F" },
  { nombre: "PANTALON", abreviacion: "P" },
];

const GENEROS = [
  { nombre: "DAMA", abreviacion: "D" },
  { nombre: "CABALLERO", abreviacion: "C" },
];

const TELA_ABREVIACIONES = {
  REPEL: "R",
  SWAN: "S",
};

const PRECIO_DEFAULT = 200;
const STOCK_MAX_DEFAULT = 10;
const MERMA_DEFAULT = 0;

function normalizarTexto(valor) {
  return `${valor || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function abreviarColor(nombre) {
  const limpio = normalizarTexto(nombre);
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  if (partes.length >= 2) {
    return `${partes[0][0] || ""}${partes[1][0] || ""}`;
  }
  return limpio.slice(0, 2);
}

function construirAbreviacionesColor(colores) {
  const grupos = new Map();

  for (const color of colores) {
    const base = abreviarColor(color.nombre);
    const arr = grupos.get(base) || [];
    arr.push(color);
    grupos.set(base, arr);
  }

  const resultado = new Map();

  for (const [base, items] of grupos.entries()) {
    if (items.length === 1) {
      resultado.set(items[0].id, base);
      continue;
    }

    items.forEach((color, index) => {
      if (index === 0) {
        resultado.set(color.id, base);
        return;
      }

      const limpio = normalizarTexto(color.nombre);
      const partes = limpio.split(/\s+/).filter(Boolean);
      let candidato = base;

      if (partes.length >= 2) {
        candidato = `${partes[0][0] || ""}${partes[1].slice(0, 2)}`;
      } else {
        candidato = limpio.slice(0, Math.min(3 + index, limpio.length));
      }

      let sufijo = 2;
      while ([...resultado.values()].includes(candidato)) {
        candidato = `${base}${sufijo}`;
        sufijo += 1;
      }

      resultado.set(color.id, candidato);
    });
  }

  return resultado;
}

async function main() {
  const [categorias, telas, tallas, colores] = await Promise.all([
    prisma.categoria.findMany(),
    prisma.tela.findMany(),
    prisma.talla.findMany(),
    prisma.color.findMany(),
  ]);

  const categoriaMap = new Map(categorias.map((item) => [normalizarTexto(item.nombre), item]));
  const telaMap = new Map(telas.map((item) => [normalizarTexto(item.nombre), item]));

  const faltantes = [
    ...TIPOS.map((item) => item.nombre).filter((nombre) => !categoriaMap.has(normalizarTexto(nombre))),
    ...Object.keys(TELA_ABREVIACIONES).filter((nombre) => !telaMap.has(normalizarTexto(nombre))),
  ];

  if (faltantes.length) {
    throw new Error(`Faltan catalogos requeridos: ${faltantes.join(", ")}`);
  }

  const colorAbreviaciones = construirAbreviacionesColor(colores);

  let creados = 0;
  let actualizados = 0;

  for (const tipo of TIPOS) {
    const categoria = categoriaMap.get(normalizarTexto(tipo.nombre));

    for (const genero of GENEROS) {
      for (const tela of telas) {
        const telaNombre = normalizarTexto(tela.nombre);
        const telaAbreviacion = TELA_ABREVIACIONES[telaNombre];
        if (!telaAbreviacion) {
          continue;
        }

        for (const talla of tallas) {
          const tallaNombre = normalizarTexto(talla.nombre);

          for (const color of colores) {
            const colorAbreviacion = colorAbreviaciones.get(color.id);
            const codigo = `${tipo.abreviacion}${genero.abreviacion}${telaAbreviacion}${tallaNombre}${colorAbreviacion}`;

            const payload = {
              codigo,
              nombre: tipo.nombre,
              genero: genero.nombre,
              tipo: tipo.nombre,
              precio: PRECIO_DEFAULT,
              mermaPorcentaje: MERMA_DEFAULT,
              stockMax: STOCK_MAX_DEFAULT,
              categoriaId: categoria.id,
              telaId: tela.id,
              tallaId: talla.id,
              colorId: color.id,
            };

            const existente = await prisma.producto.findUnique({ where: { codigo }, select: { id: true } });
            if (existente) {
              await prisma.producto.update({
                where: { codigo },
                data: payload,
              });
              actualizados += 1;
            } else {
              await prisma.producto.create({
                data: payload,
              });
              creados += 1;
            }
          }
        }
      }
    }
  }

  const total = await prisma.producto.count();
  console.log(
    JSON.stringify(
      {
        creados,
        actualizados,
        total,
        configuracion: {
          tipos: TIPOS.length,
          generos: GENEROS.length,
          telas: Object.keys(TELA_ABREVIACIONES).length,
          tallas: tallas.length,
          colores: colores.length,
          combinacionesEsperadas: TIPOS.length * GENEROS.length * Object.keys(TELA_ABREVIACIONES).length * tallas.length * colores.length,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
