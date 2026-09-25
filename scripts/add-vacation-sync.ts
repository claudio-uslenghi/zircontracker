import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

// Idempotent: adds Vacation.sourceKey (unique, nullable — NULL = loaded by hand)
// and the SyncRun log table used by the Google Sheet vacations sync. Safe to
// run repeatedly.
async function main() {
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  console.log('Adding sourceKey column to Vacation table...')
  try {
    await turso.execute(`ALTER TABLE "Vacation" ADD COLUMN "sourceKey" TEXT`)
    console.log('✅ sourceKey column added.')
  } catch (e: unknown) {
    if (e instanceof Error && e.message.toLowerCase().includes('duplicate column')) {
      console.log('ℹ️  sourceKey column already exists, skipping.')
    } else {
      throw e
    }
  }

  console.log('Creating unique index on Vacation.sourceKey...')
  await turso.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "Vacation_sourceKey_key" ON "Vacation" ("sourceKey")`)
  console.log('✅ Vacation.sourceKey unique index ready.')

  console.log('Creating SyncRun table...')
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS "SyncRun" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "source" TEXT NOT NULL,
      "trigger" TEXT NOT NULL,
      "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "ok" BOOLEAN NOT NULL,
      "created" INTEGER NOT NULL DEFAULT 0,
      "updated" INTEGER NOT NULL DEFAULT 0,
      "deleted" INTEGER NOT NULL DEFAULT 0,
      "unchanged" INTEGER NOT NULL DEFAULT 0,
      "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
      "errorCount" INTEGER NOT NULL DEFAULT 0,
      "details" TEXT NOT NULL DEFAULT ''
    )
  `)
  console.log('✅ SyncRun table ready.')

  turso.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
