import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

// Idempotente: copia cada fila de PagePermission con page='/holidays' a una
// fila equivalente con page='/feriados' (mismo roleId) — así ningún rol que
// hoy ve "Feriados por País" dentro de /holidays pierde acceso cuando esa
// gestión se muda a /feriados. INSERT OR IGNORE: correrlo de nuevo no
// duplica filas ni rompe nada si ya se corrió antes.
async function main() {
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  const { rows } = await turso.execute(`SELECT roleId FROM "PagePermission" WHERE page = '/holidays'`)
  console.log(`Encontradas ${rows.length} fila(s) de PagePermission para /holidays.`)

  for (const row of rows) {
    await turso.execute({
      sql: `INSERT OR IGNORE INTO "PagePermission" (page, roleId) VALUES (?, ?)`,
      args: ['/feriados', row.roleId as number],
    })
  }

  const { rows: after } = await turso.execute(`SELECT roleId FROM "PagePermission" WHERE page = '/feriados'`)
  console.log(`✅ /feriados ahora tiene ${after.length} fila(s) de PagePermission.`)

  turso.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
