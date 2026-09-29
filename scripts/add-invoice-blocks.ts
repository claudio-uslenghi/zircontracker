import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

// Idempotent: creates InvoiceBlock/InvoiceLineDef (the DB-backed replacement
// for the old hardcoded INVOICE_TEMPLATE in lib/invoice-sheet.ts) and, on a
// first run only, seeds the 10 real client blocks 1:1 from that template so
// no client's invoice math changes. Self-contained on purpose — the data
// below is a literal copy of the old constant, not an import, so this script
// stays valid after INVOICE_TEMPLATE is removed from the source.

const ART66 = 'Servicios exonerados literal S Art 66 T4 T.O 2023'
const ART52 = 'Servicios exonerados literal S artículo 52 Titulo 4'

type SeedItem =
  | { refSlug: string; type: 'text'; label: string }
  | { refSlug: string; type: 'blank' }
  | {
      refSlug: string
      type: 'line'
      label: string
      rate: number | null
      rateFormula?: string
      hasPerson: boolean
      person?: string | null // name to resolve against Resource, only when hasPerson
      qtyDefault?: number
      comment?: string
    }
  | { refSlug: string; type: 'sum'; label: string; over: string[]; qtyIsSum?: boolean; avgRate?: boolean; comment?: string }
  | { refSlug: string; type: 'vat'; label: string; of: string; factor: number; comment?: string }
  | { refSlug: string; type: 'discount'; label: string; from: string; rate: number; comment?: string }

interface SeedBlock {
  slug: string
  client: string
  customerName: string
  header: boolean
  okMark: boolean
  priceLabel: string
  qtyLabel: string
  unit: 'hours' | 'days'
  projectLookup: string[] | null
  paymentTermDays: number
  items: SeedItem[]
}

// customerName/paymentTermDays: confirmed for mob/claldy/ideal/smartway/cash
// against the real "Datos empresas" sheet; the rest default (client label /
// 30 days) as agreed with the user — editable afterwards from the new UI.
const SEED_BLOCKS: SeedBlock[] = [
  {
    slug: 'infogain', client: 'Infogain', customerName: 'Infogain', header: true, okMark: true,
    priceLabel: 'Precio', qtyLabel: 'Horas', unit: 'hours', projectLookup: ['Infogain'], paymentTermDays: 30,
    items: [
      { refSlug: 'infogain-luciana', type: 'line', label: `${ART66} - Salesforce Analyst - Luciana Diniz Gonçalves dos Santos`, rate: 40, hasPerson: true, person: 'Luciana Diniz', comment: 'Sin iva, hay que sumar iva.' },
      { refSlug: 'infogain-victor', type: 'line', label: `${ART66} - Power BI Analyst - Victor Córdoba`, rate: 33, hasPerson: true, person: 'Victor Cordoba', comment: 'Sin iva, hay que sumar iva.' },
      { refSlug: 'infogain-blank-1', type: 'blank' },
      { refSlug: 'infogain-sub', type: 'sum', label: ART52, over: ['infogain-luciana', 'infogain-victor'], comment: 'Sin iva' },
      { refSlug: 'infogain-vat', type: 'vat', label: `${ART52} - Software dev`, of: 'infogain-sub', factor: 1.22, comment: 'IVA incluído' },
    ],
  },
  {
    slug: 'infinite', client: 'Infinite', customerName: 'Infinite', header: true, okMark: false,
    priceLabel: 'Precio', qtyLabel: 'Horas', unit: 'hours', projectLookup: null, paymentTermDays: 30,
    items: [
      { refSlug: 'infinite-alejandro', type: 'line', label: 'Alejandro Barrios', rate: 55, hasPerson: true, person: 'Alejandro Barrios' },
      { refSlug: 'infinite-gonzalo', type: 'line', label: 'Gonzalo Torterolo', rate: 55, hasPerson: true, person: 'Gonzalo Torterolo' },
      { refSlug: 'infinite-federico', type: 'line', label: 'Federico Alvarez', rate: 55, hasPerson: true, person: 'Federico Alvarez' },
      { refSlug: 'infinite-dev', type: 'sum', label: 'Total Development', over: ['infinite-alejandro', 'infinite-gonzalo', 'infinite-federico'], qtyIsSum: true },
      { refSlug: 'infinite-blank-1', type: 'blank' },
      { refSlug: 'infinite-luz', type: 'line', label: 'Luz Gutierrez', rate: 28, hasPerson: true, person: 'Luz Gutierrez' },
      { refSlug: 'infinite-testing', type: 'sum', label: 'Total Testing', over: ['infinite-luz'] },
      { refSlug: 'infinite-blank-2', type: 'blank' },
      { refSlug: 'infinite-total', type: 'sum', label: 'Total General', over: ['infinite-testing', 'infinite-dev'] },
      { refSlug: 'infinite-blank-3', type: 'blank' },
      { refSlug: 'infinite-discount', type: 'discount', label: 'Descuento', from: 'infinite-total', rate: 20 },
    ],
  },
  {
    slug: 'hover', client: 'Hover', customerName: 'Hover', header: false, okMark: false,
    priceLabel: 'Precio', qtyLabel: 'Horas', unit: 'hours', projectLookup: null, paymentTermDays: 30,
    items: [
      { refSlug: 'hover-title', type: 'line', label: 'Hover', rate: 45, hasPerson: false, comment: 'March ok' },
      { refSlug: 'hover-ismael', type: 'line', label: 'Ismael Francisco', rate: 45, hasPerson: true, person: 'ifrancisco' },
      { refSlug: 'hover-design', type: 'line', label: 'Diseño', rate: 45, hasPerson: false },
      { refSlug: 'hover-total', type: 'sum', label: '', over: ['hover-ismael', 'hover-design'], qtyIsSum: true, avgRate: true },
    ],
  },
  {
    slug: 'suku', client: 'Suku', customerName: 'Suku', header: true, okMark: true,
    priceLabel: 'Precio', qtyLabel: 'Horas', unit: 'hours', projectLookup: ['Suku 2024'], paymentTermDays: 30,
    items: [
      { refSlug: 'suku-abdulelah', type: 'line', label: `${ART66} - Software development hours - Abdulelah`, rate: 45, hasPerson: true, person: 'Abdulelah Ragih' },
      { refSlug: 'suku-gonzalo', type: 'line', label: `${ART66} - Software development hours - Gonzalo T`, rate: 45, hasPerson: true, person: 'Gonzalo Torterolo' },
      { refSlug: 'suku-luz', type: 'line', label: `${ART66} - Manual testing hours - Luz`, rate: 25, hasPerson: true, person: 'Luz Gutierrez' },
      { refSlug: 'suku-rodrigo', type: 'line', label: `${ART66} - Automated testing hours - Rodrigo`, rate: 35, hasPerson: true, person: 'rgomez' },
      { refSlug: 'suku-hiring', type: 'line', label: `${ART66} - Hiring fee`, rate: 3750, rateFormula: '5000*1.5/2', hasPerson: false, qtyDefault: 0, comment: 'Ajustarlo según salario real' },
      { refSlug: 'suku-total', type: 'sum', label: '', over: ['suku-abdulelah', 'suku-gonzalo', 'suku-luz', 'suku-rodrigo', 'suku-hiring'], qtyIsSum: true },
      { refSlug: 'suku-text', type: 'text', label: ART66 },
    ],
  },
  {
    slug: 'imouy', client: 'IMOUY', customerName: 'IMOUY', header: true, okMark: true,
    priceLabel: 'Rate', qtyLabel: 'Days', unit: 'days', projectLookup: ['EG+', 'IMOUY'], paymentTermDays: 30,
    items: [
      { refSlug: 'imouy-facundo', type: 'line', label: 'Facundo', rate: 240, hasPerson: true, person: 'Facundo Wade' },
      { refSlug: 'imouy-blank-1', type: 'blank' },
      { refSlug: 'imouy-total', type: 'sum', label: `${ART52} - Software dev`, over: ['imouy-facundo'] },
    ],
  },
  {
    slug: 'ideal', client: 'Ideal Protein', customerName: 'Ideal Protein Company Inc.', header: true, okMark: true,
    priceLabel: 'Rate', qtyLabel: 'Hours', unit: 'hours', projectLookup: ['Ideal Protein'], paymentTermDays: 10,
    items: [
      { refSlug: 'ideal-dev', type: 'line', label: `${ART52} - Software dev`, rate: 55, hasPerson: true, person: null, comment: 'Costos' },
      { refSlug: 'ideal-testing', type: 'line', label: `${ART52} - Software testing`, rate: 30, hasPerson: true, person: 'Luz Gutierrez' },
      { refSlug: 'ideal-claude', type: 'line', label: 'Claude Code Licences', rate: 50, hasPerson: false, qtyDefault: 2 },
      { refSlug: 'ideal-total', type: 'sum', label: '', over: ['ideal-dev', 'ideal-testing', 'ideal-claude'] },
    ],
  },
  {
    slug: 'cash', client: 'Cash', customerName: 'Cash SA', header: true, okMark: false,
    priceLabel: 'Rate', qtyLabel: 'Hours', unit: 'hours', projectLookup: null, paymentTermDays: 7,
    items: [{ refSlug: 'cash-irae', type: 'line', label: 'ingresos gravados IRAE', rate: null, hasPerson: false, qtyDefault: 1 }],
  },
  {
    slug: 'smartway', client: 'Smartway', customerName: 'Nidefiler SA', header: true, okMark: false,
    priceLabel: 'Rate', qtyLabel: 'Hours', unit: 'hours', projectLookup: null, paymentTermDays: 15,
    items: [{ refSlug: 'smartway-irae', type: 'line', label: 'ingresos gravados IRAE', rate: null, hasPerson: false, qtyDefault: 1 }],
  },
  {
    slug: 'mob', client: 'MOB', customerName: 'MOBMyOwnBrandOU', header: true, okMark: true,
    priceLabel: 'Rate', qtyLabel: 'Hours', unit: 'hours', projectLookup: ['MOB Mantenimiento'], paymentTermDays: 7,
    items: [
      { refSlug: 'mob-dev', type: 'line', label: `${ART52} - Software dev`, rate: 45, hasPerson: true, person: null },
      { refSlug: 'mob-total', type: 'sum', label: '', over: ['mob-dev'] },
    ],
  },
  {
    slug: 'claldy', client: 'Claldy', customerName: 'Claldy S.A', header: true, okMark: true,
    priceLabel: 'Rate', qtyLabel: 'Hours', unit: 'hours', projectLookup: ['Claldy'], paymentTermDays: 7,
    items: [
      { refSlug: 'claldy-dev', type: 'line', label: `${ART52} - `, rate: 1, hasPerson: true, person: null },
      { refSlug: 'claldy-total', type: 'sum', label: '', over: ['claldy-dev'] },
    ],
  },
]

async function main() {
  const turso = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })

  console.log('Creating InvoiceBlock table...')
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS "InvoiceBlock" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "slug" TEXT NOT NULL,
      "client" TEXT NOT NULL,
      "customerName" TEXT NOT NULL,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "order" INTEGER NOT NULL,
      "header" BOOLEAN NOT NULL DEFAULT true,
      "okMark" BOOLEAN NOT NULL DEFAULT false,
      "priceLabel" TEXT NOT NULL DEFAULT 'Precio',
      "qtyLabel" TEXT NOT NULL DEFAULT 'Horas',
      "unit" TEXT NOT NULL DEFAULT 'hours',
      "projectId" INTEGER,
      "paymentTermDays" INTEGER NOT NULL DEFAULT 30,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `)
  await turso.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceBlock_slug_key" ON "InvoiceBlock" ("slug")`)
  console.log('✅ InvoiceBlock table ready.')

  console.log('Creating InvoiceLineDef table...')
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS "InvoiceLineDef" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "blockId" INTEGER NOT NULL,
      "refSlug" TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      "type" TEXT NOT NULL,
      "label" TEXT NOT NULL DEFAULT '',
      "rate" REAL,
      "rateFormula" TEXT,
      "hasPerson" BOOLEAN NOT NULL DEFAULT false,
      "resourceId" INTEGER,
      "qtyDefault" REAL NOT NULL DEFAULT 0,
      "comment" TEXT NOT NULL DEFAULT '',
      "refs" TEXT NOT NULL DEFAULT '',
      "factor" REAL,
      "qtyIsSum" BOOLEAN NOT NULL DEFAULT false,
      "avgRate" BOOLEAN NOT NULL DEFAULT false
    )
  `)
  await turso.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceLineDef_blockId_refSlug_key" ON "InvoiceLineDef" ("blockId", "refSlug")`)
  await turso.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceLineDef_blockId_order_key" ON "InvoiceLineDef" ("blockId", "order")`)
  console.log('✅ InvoiceLineDef table ready.')

  const existing = await turso.execute(`SELECT COUNT(*) as n FROM "InvoiceBlock"`)
  if (Number(existing.rows[0].n) > 0) {
    console.log('ℹ️  InvoiceBlock already has rows — skipping seed (this script only seeds on a first run).')
    turso.close()
    return
  }

  console.log('Seeding the 10 real client blocks from the old INVOICE_TEMPLATE...')
  const projects = await turso.execute(`SELECT id, name FROM "Project"`)
  const resources = await turso.execute(`SELECT id, name FROM "Resource"`)
  const projectIdByName = new Map(projects.rows.map((p) => [String(p.name), Number(p.id)]))
  const resourceIdByName = new Map(resources.rows.map((r) => [String(r.name).trim(), Number(r.id)]))

  const warnings: string[] = []

  for (let bi = 0; bi < SEED_BLOCKS.length; bi++) {
    const block = SEED_BLOCKS[bi]
    let projectId: number | null = null
    if (block.projectLookup) {
      for (const name of block.projectLookup) {
        if (projectIdByName.has(name)) { projectId = projectIdByName.get(name)!; break }
      }
      if (projectId === null) warnings.push(`Bloque "${block.slug}": ningún candidato de projectLookup (${block.projectLookup.join(', ')}) matcheó un Project real.`)
    }

    await turso.execute({
      sql: `INSERT INTO "InvoiceBlock" (slug, client, customerName, active, "order", header, okMark, priceLabel, qtyLabel, unit, projectId, paymentTermDays, updatedAt)
            VALUES (?, ?, ?, true, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [block.slug, block.client, block.customerName, bi, block.header, block.okMark, block.priceLabel, block.qtyLabel, block.unit, projectId, block.paymentTermDays],
    })
    const blockRow = await turso.execute({ sql: `SELECT id FROM "InvoiceBlock" WHERE slug = ?`, args: [block.slug] })
    const blockId = Number(blockRow.rows[0].id)

    for (let ii = 0; ii < block.items.length; ii++) {
      const item = block.items[ii]
      let resourceId: number | null = null
      if (item.type === 'line' && item.hasPerson && item.person) {
        resourceId = resourceIdByName.get(item.person) ?? null
        if (resourceId === null) warnings.push(`Bloque "${block.slug}", línea "${item.refSlug}": persona "${item.person}" no matcheó un Resource real.`)
      }
      const refs =
        item.type === 'sum' ? item.over.join(',') :
        item.type === 'vat' ? item.of :
        item.type === 'discount' ? item.from : ''
      const factor = item.type === 'vat' ? item.factor : item.type === 'discount' ? item.rate : null

      await turso.execute({
        sql: `INSERT INTO "InvoiceLineDef" (blockId, refSlug, "order", type, label, rate, rateFormula, hasPerson, resourceId, qtyDefault, comment, refs, factor, qtyIsSum, avgRate)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          blockId, item.refSlug, ii, item.type,
          'label' in item ? item.label : '',
          item.type === 'line' ? item.rate : null,
          item.type === 'line' ? item.rateFormula ?? null : null,
          item.type === 'line' ? item.hasPerson : false,
          resourceId,
          item.type === 'line' ? item.qtyDefault ?? 0 : 0,
          'comment' in item ? item.comment ?? '' : '',
          refs,
          factor,
          item.type === 'sum' ? !!item.qtyIsSum : false,
          item.type === 'sum' ? !!item.avgRate : false,
        ],
      })
    }
    console.log(`  ✅ ${block.slug} (${block.items.length} líneas)`)
  }

  if (warnings.length) {
    console.log('\n⚠️  Avisos:')
    warnings.forEach((w) => console.log('  - ' + w))
  }

  turso.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
