'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'

interface Payment {
  id: number
  amount: number
  date: string
  comment: string
}

interface InvoiceRow {
  id: number
  month: string
  blockId: string
  company: string
  customer: string
  description: string
  total: number
  billed: number
  dateInv: string
  comments: string
  payments: Payment[]
  paidAmount: number
  outstanding: number
  outstandingDays: number
  status: 'Pendiente' | 'Vencida' | 'Parcial' | 'Pagada'
}

const money = (n: number) => n.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const todayStr = () => new Date().toISOString().slice(0, 10)

const STATUS_STYLE: Record<InvoiceRow['status'], string> = {
  Pendiente: 'bg-gray-100 text-gray-600',
  Vencida: 'bg-red-100 text-red-700',
  Parcial: 'bg-amber-100 text-amber-700',
  Pagada: 'bg-green-100 text-green-700',
}

type SortCol = 'month' | 'customer' | 'total' | 'billed' | 'outstanding' | 'outstandingDays' | 'status'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Error')
  return data
}

function PaymentsPanel({ invoice, onChanged }: { invoice: InvoiceRow; onChanged: () => void }) {
  const [amount, setAmount] = useState<number | ''>('')
  const [date, setDate] = useState(todayStr())
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  const addPayment = async () => {
    if (amount === '' || amount <= 0) return
    setSaving(true)
    try {
      await api(`/api/invoices/${invoice.id}/payments`, { method: 'POST', body: JSON.stringify({ amount, date, comment }) })
      setAmount(''); setDate(todayStr()); setComment('')
      onChanged()
    } catch (e) {
      toast({ title: 'No se pudo cargar el pago', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const removePayment = async (paymentId: number) => {
    try {
      await api(`/api/invoices/${invoice.id}/payments/${paymentId}`, { method: 'DELETE' })
      onChanged()
    } catch (e) {
      toast({ title: 'No se pudo borrar el pago', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    }
  }

  return (
    <div className="p-3 bg-gray-50 space-y-2">
      {invoice.payments.length === 0 ? (
        <p className="text-[11px] text-gray-400">Sin pagos cargados todavía.</p>
      ) : (
        <table className="text-[11px] w-full max-w-md">
          <tbody>
            {invoice.payments.map((p) => (
              <tr key={p.id} className="border-b border-gray-100 last:border-0">
                <td className="py-1 pr-3 whitespace-nowrap">{p.date}</td>
                <td className="py-1 pr-3 text-right tabular-nums font-medium">{money(p.amount)}</td>
                <td className="py-1 pr-3 text-gray-500">{p.comment}</td>
                <td className="py-1">
                  <button onClick={() => removePayment(p.id)} className="text-gray-300 hover:text-red-500">
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Monto</label>
          <input
            type="number" step="any" value={amount}
            onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-xs w-24 text-right"
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Fecha</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs" />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] text-gray-500 mb-0.5">Comentario</label>
          <input value={comment} onChange={(e) => setComment(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs w-full" />
        </div>
        <button onClick={addPayment} disabled={saving || amount === ''} className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-40">
          <Plus size={12} /> Agregar pago
        </button>
      </div>
    </div>
  )
}

export default function InvoicesTable({ initialMonth }: { initialMonth?: string } = {}) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ rows: InvoiceRow[]; blocks: { blockId: string; client: string }[] }>({
    queryKey: ['client-invoices'],
    queryFn: () => api('/api/invoices'),
  })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const clientByBlockId = useMemo(() => new Map((data?.blocks ?? []).map((b) => [b.blockId, b.client])), [data])

  const [monthFilter, setMonthFilter] = useState(initialMonth ?? '')
  const [clientFilter, setClientFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortCol>('month')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [savingId, setSavingId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const months = useMemo(() => Array.from(new Set(rows.map((r) => r.month))).sort().reverse(), [rows])
  const clients = useMemo(
    () => Array.from(new Set(rows.map((r) => r.blockId))).map((id) => ({ id, label: clientByBlockId.get(id) ?? id })).sort((a, b) => a.label.localeCompare(b.label)),
    [rows, clientByBlockId]
  )

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!monthFilter || r.month === monthFilter) &&
          (!clientFilter || r.blockId === clientFilter) &&
          (!statusFilter || r.status === statusFilter)
      ),
    [rows, monthFilter, clientFilter, statusFilter]
  )

  const sorted = useMemo(() => {
    const factor = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'month': return a.month.localeCompare(b.month) * factor
        case 'customer': return a.customer.localeCompare(b.customer) * factor
        case 'status': return a.status.localeCompare(b.status) * factor
        default: return (a[sortBy] - b[sortBy]) * factor
      }
    })
  }, [filtered, sortBy, sortDir])

  const handleSort = (col: SortCol) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir(col === 'month' ? 'desc' : 'asc') }
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortBy !== col) return <ArrowUpDown size={12} className="opacity-40" />
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  }

  const patch = async (id: number, body: Record<string, unknown>) => {
    setSavingId(id)
    try {
      await api(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      await qc.invalidateQueries({ queryKey: ['client-invoices'] })
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    } finally {
      setSavingId(null)
    }
  }

  const refreshPayments = () => qc.invalidateQueries({ queryKey: ['client-invoices'] })

  if (isLoading) return <p className="text-sm text-gray-400 py-8 text-center">Cargando...</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
          <option value="">Todos los meses</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
          <option value="">Todos los clientes</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
          <option value="">Todos los estados</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Parcial">Parcial</option>
          <option value="Vencida">Vencida</option>
          <option value="Pagada">Pagada</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs min-w-[1100px]">
          <thead>
            <tr className="bg-[#0170B9] text-white">
              <th className="px-3 py-2.5 text-left cursor-pointer select-none" onClick={() => handleSort('month')}>
                <span className="inline-flex items-center gap-1">Mes <SortIcon col="month" /></span>
              </th>
              <th className="px-3 py-2.5 text-left cursor-pointer select-none" onClick={() => handleSort('customer')}>
                <span className="inline-flex items-center gap-1">Customer <SortIcon col="customer" /></span>
              </th>
              <th className="px-3 py-2.5 text-left">Description</th>
              <th className="px-3 py-2.5 text-right cursor-pointer select-none" onClick={() => handleSort('total')}>
                <span className="inline-flex items-center gap-1 justify-end">Total <SortIcon col="total" /></span>
              </th>
              <th className="px-3 py-2.5 text-right cursor-pointer select-none" onClick={() => handleSort('billed')}>
                <span className="inline-flex items-center gap-1 justify-end">Billed <SortIcon col="billed" /></span>
              </th>
              <th className="px-3 py-2.5 text-left">Date Inv</th>
              <th className="px-3 py-2.5 text-right">Pagado</th>
              <th className="px-3 py-2.5 text-right cursor-pointer select-none" onClick={() => handleSort('outstanding')}>
                <span className="inline-flex items-center gap-1 justify-end">Outstanding <SortIcon col="outstanding" /></span>
              </th>
              <th className="px-3 py-2.5 text-right cursor-pointer select-none" onClick={() => handleSort('outstandingDays')}>
                <span className="inline-flex items-center gap-1 justify-end">Days <SortIcon col="outstandingDays" /></span>
              </th>
              <th className="px-3 py-2.5 text-center cursor-pointer select-none" onClick={() => handleSort('status')}>
                <span className="inline-flex items-center gap-1 justify-center">Status <SortIcon col="status" /></span>
              </th>
              <th className="px-3 py-2.5 text-left">Comments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-8 text-gray-400">Sin facturas registradas</td></tr>
            ) : (
              sorted.map((r) => (
                <>
                  <tr key={r.id} className={`hover:bg-gray-50 ${savingId === r.id ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{r.month}</td>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      <input
                        defaultValue={r.customer}
                        onBlur={(e) => e.target.value.trim() !== r.customer && patch(r.id, { customer: e.target.value.trim() })}
                        className="border-0 bg-transparent w-32 focus:bg-white focus:border focus:border-gray-300 rounded px-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        defaultValue={r.description}
                        onBlur={(e) => e.target.value !== r.description && patch(r.id, { description: e.target.value })}
                        className="border-0 bg-transparent w-28 focus:bg-white focus:border focus:border-gray-300 rounded px-1"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.total)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number" step="any" defaultValue={r.billed}
                        onBlur={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isNaN(v) && v !== r.billed) patch(r.id, { billed: v })
                        }}
                        className="border-0 bg-transparent w-20 text-right tabular-nums focus:bg-white focus:border focus:border-gray-300 rounded px-1"
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.dateInv}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                        className="inline-flex items-center gap-1 tabular-nums hover:text-blue-600"
                        title="Ver/agregar pagos"
                      >
                        {expandedId === r.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {money(r.paidAmount)}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.outstanding)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.outstandingDays}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        defaultValue={r.comments}
                        onBlur={(e) => e.target.value !== r.comments && patch(r.id, { comments: e.target.value })}
                        className="border-0 bg-transparent w-36 focus:bg-white focus:border focus:border-gray-300 rounded px-1"
                      />
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr key={`${r.id}-payments`}>
                      <td colSpan={11} className="p-0">
                        <PaymentsPanel invoice={r} onChanged={refreshPayments} />
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
