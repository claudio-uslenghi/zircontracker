import { createClient } from '@libsql/client'
import * as bcrypt from 'bcryptjs'
import * as dotenv from 'dotenv'
import { randomBytes } from 'crypto'

dotenv.config()

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

const ALL_PAGES = [
  '/gantt',
  '/projects',
  '/resources',
  '/holidays',
  '/feriados',
  '/admin/users',
  '/admin/roles',
  '/admin/permissions',
]

const PLANNER_PAGES = ['/gantt', '/projects', '/resources', '/holidays', '/feriados']
const VIEWER_PAGES = ['/gantt']

async function main() {
  console.log('Creating auth tables...')

  // Create tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS "User" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "Role" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "UserRole" (
      userId INTEGER NOT NULL,
      roleId INTEGER NOT NULL,
      PRIMARY KEY (userId, roleId),
      FOREIGN KEY (userId) REFERENCES "User"(id) ON DELETE CASCADE,
      FOREIGN KEY (roleId) REFERENCES "Role"(id) ON DELETE CASCADE
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS "PagePermission" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page TEXT NOT NULL,
      roleId INTEGER NOT NULL,
      UNIQUE(page, roleId),
      FOREIGN KEY (roleId) REFERENCES "Role"(id) ON DELETE CASCADE
    )
  `)

  console.log('Tables created.')

  // Insert default roles
  await db.execute(`INSERT OR IGNORE INTO "Role" (name) VALUES ('admin')`)
  await db.execute(`INSERT OR IGNORE INTO "Role" (name) VALUES ('planner')`)
  await db.execute(`INSERT OR IGNORE INTO "Role" (name) VALUES ('viewer')`)

  const rolesResult = await db.execute(`SELECT id, name FROM "Role"`)
  const roles: Record<string, number> = {}
  for (const row of rolesResult.rows) {
    roles[row.name as string] = row.id as number
  }
  console.log('Roles:', roles)

  // Insert admin user — random one-time password, never hardcoded, since
  // this script (and its git history) is world-readable in a public repo.
  const tempPassword = randomBytes(9).toString('base64url')
  const hashedPassword = await bcrypt.hash(tempPassword, 10)
  const insertResult = await db.execute({
    sql: `INSERT OR IGNORE INTO "User" (email, password, name, active) VALUES (?, ?, ?, 1)`,
    args: ['admin@zircon.tech', hashedPassword, 'Administrador'],
  })
  const adminUserCreated = insertResult.rowsAffected > 0

  const userResult = await db.execute({
    sql: `SELECT id FROM "User" WHERE email = ?`,
    args: ['admin@zircon.tech'],
  })
  const adminId = userResult.rows[0].id as number
  console.log('Admin user id:', adminId)

  // Assign admin role to admin user
  await db.execute({
    sql: `INSERT OR IGNORE INTO "UserRole" (userId, roleId) VALUES (?, ?)`,
    args: [adminId, roles['admin']],
  })

  // Assign page permissions
  // admin: all pages
  for (const page of ALL_PAGES) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO "PagePermission" (page, roleId) VALUES (?, ?)`,
      args: [page, roles['admin']],
    })
  }

  // planner: gantt, projects, resources, holidays
  for (const page of PLANNER_PAGES) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO "PagePermission" (page, roleId) VALUES (?, ?)`,
      args: [page, roles['planner']],
    })
  }

  // viewer: gantt only
  for (const page of VIEWER_PAGES) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO "PagePermission" (page, roleId) VALUES (?, ?)`,
      args: [page, roles['viewer']],
    })
  }

  console.log('Permissions assigned.')
  if (adminUserCreated) {
    console.log('Done! Admin login: admin@zircon.tech')
    console.log(`Temporary password (only shown once, change it after first login): ${tempPassword}`)
  } else {
    console.log('Done! admin@zircon.tech already existed — its password was not changed.')
  }
}

main().catch(console.error)
