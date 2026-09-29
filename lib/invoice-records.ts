// Pure helpers for the ClientInvoice records (one row per client per month,
// generated from the "Facturas por cliente" sheet — see lib/invoice-sheet.ts).
// Outstanding/Outstanding days/status are intentionally never stored: they're
// derived here at read time so they can't go stale. Payment terms and the
// Customer display name used to be hardcoded maps here — they're now columns
// on InvoiceBlock (paymentTermDays/customerName), resolved by the caller.

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
  termDays: number
  billed: number
  paid: boolean
  dateInv: Date
  datePaid: Date | null
  now?: Date
}): InvoiceComputed {
  const { termDays, billed, paid, dateInv, datePaid, now = new Date() } = opts
  if (paid) {
    const outstandingDays = datePaid ? dayDiff(dateInv, datePaid) : dayDiff(dateInv, now)
    return { outstanding: 0, outstandingDays, status: 'Pagada' }
  }
  const outstandingDays = dayDiff(dateInv, now)
  const status: InvoiceStatus = outstandingDays > termDays ? 'Vencida' : 'Pendiente'
  return { outstanding: billed, outstandingDays, status }
}

// Last day of the given "YYYY-MM" month, as a UTC-midnight Date (matches the
// storage convention already used for Vacation/Holiday dates in this repo).
export function lastDayOfMonth(month: string): Date {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0))
}
