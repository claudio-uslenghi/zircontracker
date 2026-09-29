// Template + pure calculation for the monthly "Facturas" sheet (the per-client
// invoice worksheet the accountant gets). The structure, prices, fiscal texts
// and comments mirror the hand-built Google Sheet; the numbers (hours) come
// from time entries. The same `computeInvoice` output drives both the on-screen
// preview and the .xlsx export (with live formulas), so they can never diverge.

export type InvoiceUnit = 'hours' | 'days'

export type InvoiceItemDef =
  | { type: 'text'; text: string }
  | { type: 'blank' }
  | {
      type: 'line'
      id: string
      label: string
      rate: number | null
      // Shown as a live formula in the .xlsx while the rate is left untouched.
      rateFormula?: string
      // undefined = manual quantity (no person concept); string = default person
      // (Resource.name candidate); null = person concept but nobody by default.
      person?: string | null
      qtyDefault?: number
      comment?: string
    }
  | { type: 'sum'; id: string; label: string; over: string[]; qty?: boolean; avgRate?: boolean; comment?: string }
  | { type: 'vat'; id: string; label: string; of: string; factor: number; comment?: string }
  | { type: 'discount'; id: string; label: string; from: string; rate: number; comment?: string }

export interface InvoiceBlockDef {
  id: string
  client: string
  header: boolean
  okMark: boolean
  priceLabel: string
  qtyLabel: string
  unit: InvoiceUnit
  // Project.name candidates the hours come from; null = no project in the DB
  // for this client (quantities are typed by hand in the preview).
  projectLookup: string[] | null
  items: InvoiceItemDef[]
}

export const INVOICE_TITLE_ROWS = [
  'AGREGAR NUEVOS COMENTARIOS EN FACTURAS',
  'Servicios exonerados literal S Art 66 T4 T.O 2023',
]

// The template used to be a hardcoded array here (10 client blocks). It now
// lives in the DB (InvoiceBlock/InvoiceLineDef, see lib/invoice-template.ts)
// so an admin can add/hide clients and edit their lines without a deploy —
// computeInvoice()/getBlockTotals() below take it as a parameter instead.
// scripts/add-invoice-blocks.ts has a literal copy of the original constant,
// used once to seed the DB with the exact same 10 blocks.

export interface LineState {
  resourceName: string | null
  rate: number
  qty: number
}

export interface ComputedRow {
  blockId: string | null
  kind: 'blank' | 'title' | 'header' | 'text' | 'line' | 'sum' | 'vat' | 'discount'
  sheetRow: number
  itemId?: string
  okMark?: string
  label?: string
  priceLabel?: string
  qtyLabel?: string
  rate?: number | null
  rateFormula?: string
  qty?: number | null
  qtyFormula?: string
  total?: number | null
  totalFormula?: string
  comment?: string
  avgRate?: number
  avgRateFormula?: string
  hasPerson?: boolean
  resourceName?: string | null
  qtyEditable?: boolean
  rateEditable?: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

// Whole numbers only (agreed with the user): 167.7 h -> 168; days = h / 8.
export function hoursToQty(unit: InvoiceUnit, hours: number): number {
  return unit === 'days' ? Math.round(hours / 8) : Math.round(hours)
}

function sumFormula(col: 'D' | 'E', rowNumbers: number[]): string {
  const rows = Array.from(new Set(rowNumbers)).sort((a, b) => a - b)
  const contiguous = rows.every((r, i) => i === 0 || r === rows[i - 1] + 1)
  if (rows.length > 1 && contiguous) return `SUM(${col}${rows[0]}:${col}${rows[rows.length - 1]})`
  return `SUM(${rows.map((r) => `${col}${r}`).join(',')})`
}

export function computeInvoice(template: InvoiceBlockDef[], states: Record<string, LineState>): ComputedRow[] {
  const rows: ComputedRow[] = []
  let sheetRow = 0
  const push = (row: Omit<ComputedRow, 'sheetRow'>): ComputedRow => {
    sheetRow += 1
    const full = { ...row, sheetRow }
    rows.push(full)
    return full
  }

  push({ blockId: null, kind: 'blank' })
  INVOICE_TITLE_ROWS.forEach((text) => push({ blockId: null, kind: 'title', label: text }))
  push({ blockId: null, kind: 'blank' })
  push({ blockId: null, kind: 'blank' })

  for (const block of template) {
    const byId = new Map<string, { row: number; total: number; qty: number }>()

    if (block.header) {
      push({
        blockId: block.id, kind: 'header', okMark: block.okMark ? 'OK' : undefined,
        label: block.client, priceLabel: block.priceLabel, qtyLabel: block.qtyLabel,
      })
    }

    for (const item of block.items) {
      if (item.type === 'blank') {
        push({ blockId: block.id, kind: 'blank' })
      } else if (item.type === 'text') {
        push({ blockId: block.id, kind: 'text', label: item.text })
      } else if (item.type === 'line') {
        const st = states[item.id] ?? { resourceName: null, rate: item.rate ?? 0, qty: item.qtyDefault ?? 0 }
        const rate = item.rate === null && st.rate === 0 ? null : st.rate
        const total = round2(st.rate * st.qty)
        const row = push({
          blockId: block.id, kind: 'line', itemId: item.id, label: item.label,
          rate, rateFormula: item.rateFormula && st.rate === item.rate ? item.rateFormula : undefined,
          qty: st.qty, total, totalFormula: `C${sheetRow + 1}*D${sheetRow + 1}`,
          comment: item.comment, hasPerson: item.person !== undefined && block.projectLookup !== null,
          resourceName: st.resourceName, qtyEditable: true, rateEditable: true,
        })
        byId.set(item.id, { row: row.sheetRow, total, qty: st.qty })
      } else if (item.type === 'sum') {
        const parts = item.over.map((id) => byId.get(id)).filter((p): p is { row: number; total: number; qty: number } => !!p)
        const total = round2(parts.reduce((s, p) => s + p.total, 0))
        const qty = item.qty ? parts.reduce((s, p) => s + p.qty, 0) : null
        const r = sheetRow + 1
        const row = push({
          blockId: block.id, kind: 'sum', itemId: item.id, label: item.label, qty,
          qtyFormula: item.qty ? sumFormula('D', parts.map((p) => p.row)) : undefined,
          total, totalFormula: sumFormula('E', parts.map((p) => p.row)), comment: item.comment,
          avgRate: item.avgRate ? (qty ? round2(total / qty) : 0) : undefined,
          avgRateFormula: item.avgRate ? `E${r}/D${r}` : undefined,
        })
        byId.set(item.id, { row: row.sheetRow, total, qty: qty ?? 0 })
      } else if (item.type === 'vat') {
        const base = byId.get(item.of)
        const total = round2((base?.total ?? 0) * item.factor)
        const row = push({
          blockId: block.id, kind: 'vat', itemId: item.id, label: item.label, total,
          totalFormula: base ? `E${base.row}*${item.factor}` : undefined, comment: item.comment,
        })
        byId.set(item.id, { row: row.sheetRow, total, qty: 0 })
      } else if (item.type === 'discount') {
        const base = byId.get(item.from)
        const st = states[item.id] ?? { resourceName: null, rate: item.rate, qty: 0 }
        const total = round2((base?.total ?? 0) - st.qty)
        const r = sheetRow + 1
        const row = push({
          blockId: block.id, kind: 'discount', itemId: item.id, label: item.label,
          rate: item.rate, qty: st.qty, total, totalFormula: base ? `E${base.row}-D${r}` : undefined,
          comment: item.comment, qtyEditable: true,
        })
        byId.set(item.id, { row: row.sheetRow, total, qty: st.qty })
      }
    }
    push({ blockId: block.id, kind: 'blank' })
  }
  return rows
}

// The total billed to a client that month: by construction, the last
// non-blank row of a block is always its grand total (the VAT-inclusive sum
// for infogain, the post-discount total for infinite, the single line for
// cash/smartway, etc.) — no separate "block total" concept needed elsewhere.
export function getBlockTotals(template: InvoiceBlockDef[], rows: ComputedRow[]): { blockId: string; client: string; total: number }[] {
  const clientById = new Map(template.map((b) => [b.id, b.client]))
  const lastByBlock = new Map<string, number>()
  for (const row of rows) {
    if (!row.blockId || row.kind === 'blank' || row.total == null) continue
    lastByBlock.set(row.blockId, row.total)
  }
  return Array.from(lastByBlock.entries()).map(([blockId, total]) => ({
    blockId, client: clientById.get(blockId) ?? blockId, total,
  }))
}

export interface XlsxCell {
  v?: string | number
  f?: string
}

// Columns A..F (OK | concept | price | qty | total | comment), one array per
// sheet row (index 0 = row 1). Numeric cells with a formula carry the cached value.
export function computedRowsToCells(rows: ComputedRow[]): XlsxCell[][] {
  return rows.map((row) => {
    const cells: XlsxCell[] = [{}, {}, {}, {}, {}, {}]
    if (row.kind === 'header') {
      if (row.okMark) cells[0] = { v: row.okMark }
      cells[1] = { v: row.label }
      cells[2] = { v: row.priceLabel }
      cells[3] = { v: row.qtyLabel }
      cells[4] = { v: 'Total' }
    } else if (row.kind === 'title' || row.kind === 'text') {
      cells[1] = { v: row.label }
    } else if (row.kind !== 'blank') {
      if (row.label) cells[1] = { v: row.label }
      if (row.rate !== undefined && row.rate !== null) cells[2] = row.rateFormula ? { v: row.rate, f: row.rateFormula } : { v: row.rate }
      if (row.qty !== undefined && row.qty !== null) cells[3] = row.qtyFormula ? { v: row.qty, f: row.qtyFormula } : { v: row.qty }
      if (row.total !== undefined && row.total !== null) cells[4] = row.totalFormula ? { v: row.total, f: row.totalFormula } : { v: row.total }
      if (row.avgRate !== undefined) cells[5] = { v: row.avgRate, f: row.avgRateFormula }
      else if (row.comment) cells[5] = { v: row.comment }
    }
    return cells
  })
}
