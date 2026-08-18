import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

async function main() {
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  // 1. Add Resource.email column (idempotent)
  console.log('Adding email column to Resource table...')
  try {
    await turso.execute(`ALTER TABLE "Resource" ADD COLUMN "email" TEXT`)
    console.log('✅ email column added.')
  } catch (e: unknown) {
    if (e instanceof Error && e.message.toLowerCase().includes('duplicate column')) {
      console.log('ℹ️  email column already exists, skipping.')
    } else {
      throw e
    }
  }

  console.log('Creating unique index on Resource.email...')
  await turso.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Resource_email_key" ON "Resource" ("email")
  `)
  console.log('✅ Resource.email unique index ready.')

  // 2. Create Task table (idempotent)
  console.log('Creating Task table...')
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS "Task" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "projectId" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE
    )
  `)
  console.log('✅ Task table ready.')

  // 3. Add TimeEntry.taskId column (idempotent)
  console.log('Adding taskId column to TimeEntry table...')
  try {
    await turso.execute(`ALTER TABLE "TimeEntry" ADD COLUMN "taskId" INTEGER REFERENCES "Task" ("id")`)
    console.log('✅ taskId column added.')
  } catch (e: unknown) {
    if (e instanceof Error && e.message.toLowerCase().includes('duplicate column')) {
      console.log('ℹ️  taskId column already exists, skipping.')
    } else {
      throw e
    }
  }

  // 4. Replace unique index on TimeEntry to include taskId
  console.log('Dropping old unique index on TimeEntry...')
  await turso.execute(`DROP INDEX IF EXISTS "TimeEntry_resourceId_projectId_date_entryType_key"`)
  console.log('✅ Old unique index dropped (or did not exist).')

  console.log('Creating new unique index on (resourceId, projectId, date, entryType, taskId)...')
  await turso.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS "TimeEntry_resourceId_projectId_date_entryType_taskId_key"
    ON "TimeEntry" (resourceId, projectId, date, entryType, taskId)
  `)
  console.log('✅ New unique index created.')

  turso.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
