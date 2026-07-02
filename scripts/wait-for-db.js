const mysql = require("mysql2/promise");

const databaseUrl = process.env.DATABASE_URL;
const maxAttempts = Number(process.env.DB_WAIT_ATTEMPTS || 30);
const delayMs = Number(process.env.DB_WAIT_DELAY_MS || 5000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDatabase() {
  if (!databaseUrl) {
    console.error("DATABASE_URL no esta configurada.");
    process.exit(1);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let connection;
    try {
      connection = await mysql.createConnection(databaseUrl);
      await connection.query("SELECT 1");
      console.log(`Base de datos disponible en intento ${attempt}/${maxAttempts}.`);
      await connection.end();
      return;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      console.warn(`Esperando base de datos (${attempt}/${maxAttempts}): ${message}`);
      if (connection) {
        await connection.end().catch(() => undefined);
      }
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }

  console.error(`No se pudo conectar a la base de datos despues de ${maxAttempts} intentos.`);
  process.exit(1);
}

waitForDatabase();
