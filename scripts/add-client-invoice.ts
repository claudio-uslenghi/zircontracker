import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

// Idempotent: creates the ClientInvoice table (one record per client per
// month, generated/updated when the admin downloads the Facturación .xlsx).
// Safe to run repeatedly.
async function main() {
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  console.log('Creating ClientInvoice table...')
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS "ClientInvoice" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "month" TEXT NOT NULL,
      "blockId" TEXT NOT NULL,
      "company" TEXT NOT NULL DEFAULT 'Zircon',
      "customer" TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "total" REAL NOT NULL,
      "billed" REAL NOT NULL,
      "dateInv" DATETIME NOT NULL,
      "paid" BOOLEAN NOT NULL DEFAULT false,
      "datePaid" DATETIME,
      "comments" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `)
  console.log('✅ ClientInvoice table ready.')

  console.log('Creating unique index on ClientInvoice(month, blockId)...')
  await turso.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientInvoice_month_blockId_key" ON "ClientInvoice" ("month", "blockId")`
  )
  console.log('✅ ClientInvoice.month_blockId unique index ready.')

  turso.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
