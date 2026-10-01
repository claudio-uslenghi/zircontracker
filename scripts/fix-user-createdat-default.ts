import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

// Idempotent: fixes the real SQL-level DEFAULT on User.createdAt. It was
// `datetime('now')`, which produces "YYYY-MM-DD HH:MM:SS" (space, no "Z") —
// a format `prisma.user.findUnique()` can't parse as DateTime. Any User row
// inserted by raw SQL without an explicit createdAt (bypassing Prisma, which
// always generates its own ISO-8601 value) silently breaks that user's
// login with a 401 and no server-side error logged anywhere obvious.
// Confirmed harmless for every real user today — all existing rows were
// created through Prisma and already have a parseable value — this only
// fixes the column DEFAULT so a future raw-SQL insert doesn't fall into the
// same trap. Approved by the user in chat before running against the real
// Turso DB (see SPEC.md / conversation — SQLite has no
// `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT`, so the fix is the standard
// rebuild: create a corrected copy, copy the rows over as-is, drop the old
// table, rename).
async function main() {
  const turso = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })

  const current = await turso.execute(`SELECT sql FROM sqlite_master WHERE type='table' AND name='User'`)
  const currentSql = String(current.rows[0]?.sql ?? '')
  if (currentSql.includes("strftime('%Y-%m-%dT%H:%M:%fZ','now')")) {
    console.log('ℹ️  User.createdAt ya tiene el DEFAULT correcto — nada que hacer.')
    turso.close()
    return
  }
  console.log('DEFAULT actual:', currentSql.match(/createdAt[^,)]*/)?.[0] ?? '(no encontrado)')

  await turso.execute('PRAGMA foreign_keys=OFF')
  await turso.batch(
    [
      `CREATE TABLE "User_new" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
      `INSERT INTO "User_new" (id, email, password, name, active, createdAt)
       SELECT id, email, password, name, active, createdAt FROM "User"`,
      `DROP TABLE "User"`,
      `ALTER TABLE "User_new" RENAME TO "User"`,
    ],
    'write'
  )

  const check = await turso.execute('PRAGMA foreign_key_check')
  if (check.rows.length > 0) {
    console.error('❌ foreign_key_check encontró problemas:', JSON.stringify(check.rows))
    process.exit(1)
  }
  await turso.execute('PRAGMA foreign_keys=ON')

  const after = await turso.execute(`SELECT sql FROM sqlite_master WHERE type='table' AND name='User'`)
  console.log('✅ User recreada. Nuevo DEFAULT:', String(after.rows[0].sql).match(/createdAt[^,)]*/)?.[0])

  const count = await turso.execute('SELECT COUNT(*) as n FROM "User"')
  console.log(`✅ ${count.rows[0].n} fila(s) de User preservadas.`)

  turso.close()
  console.log('\nFix complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
