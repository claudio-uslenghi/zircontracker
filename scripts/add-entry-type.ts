import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

async function main() {
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  // 1. Add entryType column (idempotent)
  console.log('Adding entryType column to TimeEntry table...')
  try {
    await turso.execute(`ALTER TABLE "TimeEntry" ADD COLUMN "entryType" TEXT NOT NULL DEFAULT 'regular'`)
    console.log('✅ entryType column added.')
  } catch (e: unknown) {
    if (e instanceof Error && e.message.toLowerCase().includes('duplicate column')) {
      console.log('ℹ️  entryType column already exists, skipping.')
    } else {
      throw e
    }
  }

  // 2. Drop old unique index on (resourceId, projectId, date)
  console.log('Dropping old unique index...')
  await turso.execute(`DROP INDEX IF EXISTS "TimeEntry_resourceId_projectId_date_key"`)
  console.log('✅ Old unique index dropped (or did not exist).')

  // 3. Create new unique index including entryType
  console.log('Creating new unique index on (resourceId, projectId, date, entryType)...')
  await turso.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS "TimeEntry_resourceId_projectId_date_entryType_key"
    ON "TimeEntry" (resourceId, projectId, date, entryType)
  `)
  console.log('✅ New unique index created.')

  turso.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
