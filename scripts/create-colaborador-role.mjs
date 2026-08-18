import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'
import * as dotenv from 'dotenv'
dotenv.config()

const libsql = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
const adapter = new PrismaLibSQL(libsql)
const prisma = new PrismaClient({ adapter })

const role = await prisma.role.upsert({
  where: { name: 'colaborador' },
  update: {},
  create: { name: 'colaborador' },
})
console.log('Role "colaborador" ready, id:', role.id)

const pages = ['/projects', '/holidays', '/mis-horas', '/mi-reporte']
for (const page of pages) {
  await prisma.pagePermission.upsert({
    where: { page_roleId: { page, roleId: role.id } },
    update: {},
    create: { page, roleId: role.id },
  })
  console.log('  granted', page)
}

console.log('Done. Next steps for onboarding a real colaborador:')
console.log('1. En /admin/users, crear el usuario con el email real de la persona y asignarle el rol "colaborador".')
console.log('2. En la ficha del Resource correspondiente (o vía script), completar Resource.email con ese mismo email.')

await prisma.$disconnect()
