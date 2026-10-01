import * as dotenv from 'dotenv'
import { createClient } from '@libsql/client'

dotenv.config()

// Idempotent: adds Project/Resource.invoicingHidden + invoicingOrder (wizard
// step 1 — see SPEC.md "Wizard de facturación mensual"), replacing the old
// hardcoded INVOICING_PROJECT_ORDER/INVOICING_RESOURCE_ORDER lists that used
// to live in lib/invoicing-report.ts (deleted once this ran — this script
// keeps its own literal copy below, same pattern as
// scripts/add-invoice-blocks.ts) with a real, admin-editable list. Seeds
// invoicingOrder (1000-step spacing) from the old curated order for
// whatever matches a real Project/Resource name — anything real that was
// NOT in those lists (e.g. Diego Mortenssen) is left with invoicingOrder =
// null, invoicingHidden = false, so it shows up at the end, visible, next
// time the pivot is built. Safe to re-run: only seeds a column once, only
// for rows that still have invoicingOrder = null.
const ORDER_STEP = 1000

interface OrderEntry { label: string; lookupNames: string[] }

const PROJECT_ORDER: OrderEntry[] = [
  { label: 'SCC-Congroup', lookupNames: ['SCC-Congroup'] },
  { label: 'Breinchild', lookupNames: ['Breinchild'] },
  { label: 'IMOUY  (EG+)', lookupNames: ['EG+', 'IMOUY'] },
  { label: 'Ideal Protein', lookupNames: ['Ideal Protein'] },
  { label: 'Bench  (Internal Issues)', lookupNames: ['Internal Issues', 'Bench'] },
  { label: 'MOB Mantenimiento', lookupNames: ['MOB Mantenimiento'] },
  { label: 'SCC-Holcim', lookupNames: ['SCC-Holcim'] },
  { label: 'SmartWay', lookupNames: ['SmartWay'] },
  { label: 'StarCenter', lookupNames: ['StarCenter'] },
  { label: 'Suku 2024', lookupNames: ['Suku 2024'] },
  { label: 'Infogain', lookupNames: ['Infogain'] },
  { label: 'AI Assessments', lookupNames: ['AI Assessments'] },
  { label: 'Claldy', lookupNames: ['Claldy'] },
  { label: 'HubID-Guardian', lookupNames: ['HubID-Guardian'] },
]

const RESOURCE_ORDER: OrderEntry[] = [
  { label: 'Raul Velazquez', lookupNames: ['Raul Velazquez'] },
  { label: 'Abdulelah Ragih', lookupNames: ['Abdulelah Ragih'] },
  { label: 'AVNER NAHUM', lookupNames: ['AVNER Santos', 'AVNER NAHUM'] },
  { label: 'Bruno Rodrigues Lopes', lookupNames: ['Bruno Rodrigues Lopes'] },
  { label: 'Bsilva', lookupNames: ['Betzabe Silva'] },
  { label: 'Claudio Uslenghi', lookupNames: ['Claudio Uslenghi'] },
  { label: 'EDUARDO NOGUEIRA', lookupNames: ['Eduardo Nogueira Vicentini', 'EDUARDO NOGUEIRA'] },
  { label: 'Facundo Wade Jacobs (fwade)', lookupNames: ['Facundo Wade'] },
  { label: 'Gonzalo Torterolo', lookupNames: ['Gonzalo Torterolo'] },
  { label: 'Kevin Yan', lookupNames: ['Kevin Yan'] },
  { label: 'lgutierrez', lookupNames: ['Luz Gutierrez'] },
  { label: 'PABLO RAPPALINI', lookupNames: ['PABLO RAPPALINI'] },
  { label: 'Rafael Basile', lookupNames: ['Rafael Basile'] },
  { label: 'rgomez', lookupNames: ['rgomez'] },
  { label: 'RICARDO AMARANTE', lookupNames: ['RICARDO AMARANTE'] },
  { label: 'Will Olivera', lookupNames: ['Will Olivera'] },
  { label: 'Yan - Kreitech', lookupNames: ['Yan'] },
  { label: 'Luciana Diniz Gonçalves dos Santos', lookupNames: ['Luciana Diniz'] },
  { label: 'Victor Córdoba', lookupNames: ['Victor Cordoba', 'Victor Córdoba'] },
  { label: 'Nicolas Daneri', lookupNames: ['Nicolas Daneri'] },
  { label: 'Nelson Toledo', lookupNames: ['Nelson Toledo'] },
]

function resolveOrder(order: OrderEntry[], dbNames: string[]): { label: string; resolvedName: string | null }[] {
  const byLower = new Map(dbNames.map((n) => [n.trim().toLowerCase(), n]))
  return order.map((entry) => {
    for (const candidate of entry.lookupNames) {
      const match = byLower.get(candidate.trim().toLowerCase())
      if (match) return { label: entry.label, resolvedName: match }
    }
    return { label: entry.label, resolvedName: null }
  })
}

async function main() {
  const turso = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })

  for (const table of ['Project', 'Resource']) {
    const cols = await turso.execute(`PRAGMA table_info("${table}")`)
    const names = cols.rows.map((c) => c.name)
    if (!names.includes('invoicingHidden')) {
      await turso.execute(`ALTER TABLE "${table}" ADD COLUMN "invoicingHidden" BOOLEAN NOT NULL DEFAULT false`)
      console.log(`✅ ${table}.invoicingHidden agregada.`)
    } else {
      console.log(`ℹ️  ${table}.invoicingHidden ya existía.`)
    }
    if (!names.includes('invoicingOrder')) {
      await turso.execute(`ALTER TABLE "${table}" ADD COLUMN "invoicingOrder" INTEGER`)
      console.log(`✅ ${table}.invoicingOrder agregada.`)
    } else {
      console.log(`ℹ️  ${table}.invoicingOrder ya existía.`)
    }
  }

  async function seed(table: 'Project' | 'Resource', order: OrderEntry[]) {
    const rows = await turso.execute(`SELECT id, name, invoicingOrder FROM "${table}"`)
    const alreadySeeded = rows.rows.some((r) => r.invoicingOrder != null)
    if (alreadySeeded) {
      console.log(`ℹ️  ${table}: ya hay invoicingOrder seteado en algún registro — no vuelvo a sembrar (re-run seguro).`)
      return
    }
    const dbNames = rows.rows.map((r) => r.name as string)
    const resolved = resolveOrder(order, dbNames)
    const idByName = new Map(rows.rows.map((r) => [(r.name as string).trim().toLowerCase(), r.id as number]))
    let seeded = 0
    let step = ORDER_STEP
    for (const entry of resolved) {
      if (!entry.resolvedName) {
        console.log(`   (sin match real, se saltea: "${entry.label}")`)
        continue
      }
      const id = idByName.get(entry.resolvedName.trim().toLowerCase())
      if (id == null) continue
      await turso.execute({ sql: `UPDATE "${table}" SET invoicingOrder = ? WHERE id = ?`, args: [step, id] })
      step += ORDER_STEP
      seeded += 1
    }
    const total = rows.rows.length
    console.log(`✅ ${table}: ${seeded} sembrado(s) con el orden curado actual. ${total - seeded} quedan con invoicingOrder=null (van al final, visibles) — entre ellos cualquier Proyecto/Recurso real que hoy no estaba en la lista hardcodeada.`)
  }

  console.log('\nSembrando orden de Proyectos...')
  await seed('Project', PROJECT_ORDER)
  console.log('\nSembrando orden de Recursos...')
  await seed('Resource', RESOURCE_ORDER)

  turso.close()
  console.log('\nMigration complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
