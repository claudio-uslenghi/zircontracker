export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { sortByEffectiveOrder } from '@/lib/pivot-order'
import { BENCH_COLUMN_NAME, computeBenchHours } from '@/lib/invoicing-bench'
import { computeInvoice, computedRowsToCells, getBlockTotals, type LineState } from '@/lib/invoice-sheet'
import { getInvoiceTemplate } from '@/lib/invoice-template'
import { lastDayOfMonth } from '@/lib/invoice-records'
import { syncInvoicingMonth } from '@/lib/google-sheets'

// Generates the final .xlsx for the monthly "Info para invoicing" report.
// The resource/project universe is whatever is visible in the pivot (wizard
// step 1 — invoicingHidden: false, see lib/pivot-order.ts) at the moment of
// generation — no more client-supplied include lists, hiding is curated
// ahead of time and persists on its own.
// When `invoiceLines` is sent (the edited state of the "Facturas" preview), a
// second sheet "Facturas" is added, with live formulas in the Total column.
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const month: string = body.month

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Parámetro month inválido (YYYY-MM)' }, { status: 400 })
  }
  const [y, m] = month.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0))
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59))

  const [visibleResources, visibleProjects] = await Promise.all([
    prisma.resource.findMany({ where: { invoicingHidden: false }, select: { id: true, name: true, invoicingOrder: true } }),
    prisma.project.findMany({ where: { invoicingHidden: false }, select: { id: true, name: true, invoicingOrder: true } }),
  ])
  const resources = sortByEffectiveOrder(visibleResources)
  const projects = sortByEffectiveOrder(visibleProjects)
  const resourceIds = resources.map((r) => r.id)

  const grouped = resourceIds.length
    ? await prisma.timeEntry.groupBy({
        by: ['resourceId', 'projectId'],
        where: { date: { gte: from, lte: to }, resourceId: { in: resourceIds } },
        _sum: { hours: true },
      })
    : []

  const hoursMap = new Map<string, number>()
  for (const g of grouped) hoursMap.set(`${g.resourceId}|${g.projectId}`, g._sum.hours ?? 0)

  const header = ['Recurso', 'Total Horas', ...projects.map((p) => p.name), BENCH_COLUMN_NAME]
  const rows: (string | number)[][] = [header]

  const visibleTotalByResource = new Map<number, number>()
  const perResourceRowValues = new Map<number, number[]>()
  for (const r of resources) {
    const rowValues: number[] = []
    let total = 0
    for (const p of projects) {
      const hours = hoursMap.get(`${r.id}|${p.id}`) ?? 0
      rowValues.push(Math.round(hours * 100) / 100)
      total += hours
    }
    visibleTotalByResource.set(r.id, total)
    perResourceRowValues.set(r.id, rowValues)
  }

  const benchByResource = await computeBenchHours(resourceIds, visibleTotalByResource, from, to)
  for (const r of resources) {
    const bench = benchByResource.get(r.id) ?? 0
    const total = Math.round(((visibleTotalByResource.get(r.id) ?? 0) + bench) * 100) / 100
    rows.push([r.name, total, ...perResourceRowValues.get(r.id)!, bench])
  }

  const XLSX = await import('xlsx')
  const infoSheet = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()

  // "Facturas por cliente" goes first, "Info para invoicing" last — the
  // accountant works off the invoice sheet, the pivot is backup detail.
  const invoiceLines: Record<string, LineState> | undefined = body.invoiceLines
  let recordsSummary = ''
  let sheetsSyncStatus = ''
  if (invoiceLines) {
    const template = await getInvoiceTemplate({ activeOnly: true })
    const computedRows = computeInvoice(template, invoiceLines)
    const cells = computedRowsToCells(computedRows)
    const sheet: Record<string, unknown> = {}
    cells.forEach((rowCells, r) => {
      rowCells.forEach((cell, c) => {
        if (cell.v === undefined) return
        const ref = XLSX.utils.encode_cell({ r, c })
        if (typeof cell.v === 'number') sheet[ref] = cell.f ? { t: 'n', v: cell.v, f: cell.f } : { t: 'n', v: cell.v }
        else sheet[ref] = { t: 's', v: cell.v }
      })
    })
    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(cells.length - 1, 0), c: 5 } })
    sheet['!cols'] = [{ wch: 5 }, { wch: 95 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 34 }]
    XLSX.utils.book_append_sheet(wb, sheet as import('xlsx').WorkSheet, 'Facturas')

    // Generate/update one ClientInvoice record per client with Total > 0 this
    // month. Regenerating never touches billed/paid/datePaid/comments/customer/
    // description/dateInv once a record exists — only `total` is refreshed.
    const blockTotals = getBlockTotals(template, computedRows).filter((b) => b.total > 0)
    const customerNameBySlug = new Map(
      (await prisma.invoiceBlock.findMany({ where: { slug: { in: blockTotals.map((b) => b.blockId) } }, select: { slug: true, customerName: true } }))
        .map((b) => [b.slug, b.customerName])
    )
    const existing = await prisma.clientInvoice.findMany({
      where: { month, blockId: { in: blockTotals.map((b) => b.blockId) } },
      select: { blockId: true },
    })
    const existingIds = new Set(existing.map((e) => e.blockId))
    const dateInv = lastDayOfMonth(month)

    await prisma.$transaction(
      blockTotals.map((b) =>
        prisma.clientInvoice.upsert({
          where: { month_blockId: { month, blockId: b.blockId } },
          create: {
            month, blockId: b.blockId, customer: customerNameBySlug.get(b.blockId) ?? b.client,
            total: b.total, billed: b.total, dateInv,
          },
          update: { total: b.total },
        })
      )
    )
    const created = blockTotals.filter((b) => !existingIds.has(b.blockId)).length
    const updated = blockTotals.length - created
    recordsSummary = `created=${created};updated=${updated}`

    // Espejo best-effort en la planilla real de Google Sheets (dos tabs,
    // creados o actualizados). Nunca bloquea la descarga del .xlsx ni la
    // creación de los ClientInvoice de arriba.
    const sync = await syncInvoicingMonth(month, rows, cells, computedRows)
    sheetsSyncStatus = sync.status === 'error'
      ? `error:${encodeURIComponent((sync.message ?? 'Error desconocido').slice(0, 300))}`
      : sync.status
  }

  XLSX.utils.book_append_sheet(wb, infoSheet, 'Info para invoicing')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="invoicing-${month}.xlsx"`,
      ...(recordsSummary ? { 'X-Invoice-Records-Summary': recordsSummary } : {}),
      ...(sheetsSyncStatus ? { 'X-Sheets-Sync-Status': sheetsSyncStatus } : {}),
    },
  })
}
