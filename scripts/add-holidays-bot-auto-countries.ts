import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

// Idempotente: crea la tabla HolidaysBotAutoCountry (países del envío
// automático del Holidays Bot) y la siembra con la lista inicial acordada
// solo cuando la crea. Si la tabla ya existía (aunque esté vacía) no la
// toca, así que correrlo de nuevo no pisa la configuración de un admin.
const INITIAL_COUNTRIES = ['Argentina', 'Brasil', 'Chile', 'Uruguay', 'Yemen']

async function main() {
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  // La siembra es solo para cuando la tabla se crea por primera vez: si ya
  // existe y está vacía, un admin eligió "ningún país" y no se le pisa.
  const { rows: existing } = await turso.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'HolidaysBotAutoCountry'`
  )
  const alreadyExisted = existing.length > 0

  await turso.execute(`CREATE TABLE IF NOT EXISTS "HolidaysBotAutoCountry" ("country" TEXT NOT NULL PRIMARY KEY)`)
  console.log('✅ Tabla HolidaysBotAutoCountry lista.')

  if (!alreadyExisted) {
    for (const country of INITIAL_COUNTRIES) {
      await turso.execute({ sql: `INSERT OR IGNORE INTO "HolidaysBotAutoCountry" (country) VALUES (?)`, args: [country] })
    }
    console.log(`✅ Sembrada con: ${INITIAL_COUNTRIES.join(', ')}.`)
  } else {
    const { rows } = await turso.execute(`SELECT COUNT(*) AS n FROM "HolidaysBotAutoCountry"`)
    console.log(`La tabla ya existía con ${rows[0].n} fila(s) — no se siembra.`)
  }

  turso.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
