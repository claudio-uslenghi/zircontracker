// Pure helpers for the ClientInvoice records (one row per client per month,
// generated from the "Facturas por cliente" sheet — see lib/invoice-sheet.ts).
// Outstanding/Outstanding days/status are intentionally never stored: they're
// derived here from the invoice's InvoicePayment rows at read time so they
// can't go stale. Payment terms and the Customer display name used to be
// hardcoded maps here — they're now columns on InvoiceBlock
// (paymentTermDays/customerName), resolved by the caller.

export type InvoiceStatus = 'Pendiente' | 'Vencida' | 'Parcial' | 'Pagada'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const round2 = (n: number) => Math.round(n * 100) / 100

function dayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.max(0, Math.round((b - a) / MS_PER_DAY))
}

export interface InvoiceComputed {
  paidAmount: number
  outstanding: number
  outstandingDays: number
  status: InvoiceStatus
}

// Sobrepago (suma de pagos > billed) está permitido a propósito — Outstanding
// puede quedar negativo (a favor del cliente) en vez de bloquear la carga de
// un pago real.
export function computeInvoiceStatus(opts: {
  termDays: number
  billed: number
  payments: { amount: number; date: Date }[]
  dateInv: Date
  now?: Date
}): InvoiceComputed {
  const { termDays, billed, payments, dateInv, now = new Date() } = opts
  const paidAmount = round2(payments.reduce((s, p) => s + p.amount, 0))
  const outstanding = round2(billed - paidAmount)
  const outstandingDays = dayDiff(dateInv, now)

  if (paidAmount >= billed) {
    const lastPaymentDate = payments.length
      ? payments.reduce((latest, p) => (p.date > latest ? p.date : latest), payments[0].date)
      : null
    return {
      paidAmount,
      outstanding,
      outstandingDays: lastPaymentDate ? dayDiff(dateInv, lastPaymentDate) : outstandingDays,
      status: 'Pagada',
    }
  }

  // Overdue takes priority over "partial" — a client who paid part of an
  // overdue invoice still owes a late balance, which matters more for
  // collections than the fact that some of it came in.
  if (outstandingDays > termDays) {
    return { paidAmount, outstanding, outstandingDays, status: 'Vencida' }
  }
  if (paidAmount > 0) {
    return { paidAmount, outstanding, outstandingDays, status: 'Parcial' }
  }
  return { paidAmount, outstanding, outstandingDays, status: 'Pendiente' }
}

// Last day of the given "YYYY-MM" month, as a UTC-midnight Date (matches the
// storage convention already used for Vacation/Holiday dates in this repo).
export function lastDayOfMonth(month: string): Date {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0))
}
