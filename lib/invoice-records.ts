// Pure helpers for the ClientInvoice records (one row per client per month,
// generated from the "Facturas por cliente" sheet — see lib/invoice-sheet.ts).
// Outstanding/Outstanding days/status are intentionally never stored: they're
// derived here at read time so they can't go stale.

// Payment terms in days, sourced from the real "Datos empresas" sheet tab.
// The five without a confirmed term (infogain, infinite, hover, suku, imouy)
// default to 30 days — flagged in SPEC.md as an open question.
export const CLIENT_PAYMENT_TERM_DAYS: Record<string, number> = {
  mob: 7,
  claldy: 7,
  ideal: 10,
  smartway: 15,
  cash: 7,
  infogain: 30,
  infinite: 30,
  hover: 30,
  suku: 30,
  imouy: 30,
}

// Display name for the "Customer" field. Confirmed legal names for 5 clients;
// the rest fall back to the block's own label as an editable placeholder.
export const CLIENT_DISPLAY_NAME: Record<string, string> = {
  mob: 'MOBMyOwnBrandOU',
  claldy: 'Claldy S.A',
  ideal: 'Ideal Protein Company Inc.',
  smartway: 'Nidefiler SA',
  cash: 'Cash SA',
}

export type InvoiceStatus = 'Pendiente' | 'Vencida' | 'Pagada'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function dayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.max(0, Math.round((b - a) / MS_PER_DAY))
}

export interface InvoiceComputed {
  outstanding: number
  outstandingDays: number
  status: InvoiceStatus
}

export function computeInvoiceStatus(opts: {
  blockId: string
  billed: number
  paid: boolean
  dateInv: Date
  datePaid: Date | null
  now?: Date
}): InvoiceComputed {
  const { blockId, billed, paid, dateInv, datePaid, now = new Date() } = opts
  if (paid) {
    const outstandingDays = datePaid ? dayDiff(dateInv, datePaid) : dayDiff(dateInv, now)
    return { outstanding: 0, outstandingDays, status: 'Pagada' }
  }
  const outstandingDays = dayDiff(dateInv, now)
  const termDays = CLIENT_PAYMENT_TERM_DAYS[blockId] ?? 30
  const status: InvoiceStatus = outstandingDays > termDays ? 'Vencida' : 'Pendiente'
  return { outstanding: billed, outstandingDays, status }
}

// Last day of the given "YYYY-MM" month, as a UTC-midnight Date (matches the
// storage convention already used for Vacation/Holiday dates in this repo).
export function lastDayOfMonth(month: string): Date {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0))
}
