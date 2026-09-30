import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

// Idempotent: creates InvoicePayment (partial-payment records for
// ClientInvoice — see SPEC.md "Pagos parciales en facturas"), migrates the
// old ClientInvoice.paid/datePaid booleans into one synthetic payment row
// per already-paid invoice (so existing "Pagada" invoices don't regress to
// "Pendiente"), then drops those two columns since Outstanding/status are
// now always derived from the sum of InvoicePayment rows.
async function main() {
  const turso = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })

  console.log('Creating InvoicePayment table...')
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS "InvoicePayment" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "invoiceId" INTEGER NOT NULL,
      "amount" REAL NOT NULL,
      "date" DATETIME NOT NULL,
      "comment" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  console.log('✅ InvoicePayment table ready.')

  // Only attempt the backfill/drop if the legacy columns are still there —
  // safe to re-run this script after they're already gone.
  const cols = await turso.execute(`PRAGMA table_info("ClientInvoice")`)
  const hasPaidColumn = cols.rows.some((c) => c.name === 'paid')

  if (hasPaidColumn) {
    console.log('Migrating paid=true invoices into InvoicePayment rows...')
    const paidInvoices = await turso.execute(`SELECT id, billed, dateInv, datePaid FROM "ClientInvoice" WHERE paid = true`)
    for (const inv of paidInvoices.rows) {
      const date = inv.datePaid ?? inv.dateInv
      await turso.execute({
        sql: `INSERT INTO "InvoicePayment" (invoiceId, amount, date, comment) VALUES (?, ?, ?, ?)`,
        args: [inv.id, inv.billed, date, 'Migrado desde el campo Paid anterior.'],
      })
    }
    console.log(`✅ ${paidInvoices.rows.length} pago(s) migrado(s).`)

    console.log('Dropping ClientInvoice.paid / ClientInvoice.datePaid...')
    await turso.execute(`ALTER TABLE "ClientInvoice" DROP COLUMN "paid"`)
    await turso.execute(`ALTER TABLE "ClientInvoice" DROP COLUMN "datePaid"`)
    console.log('✅ Columnas viejas eliminadas.')
  } else {
    console.log('ℹ️  Legacy paid/datePaid columns already gone — nothing to migrate.')
  }

  turso.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
