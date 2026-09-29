'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { toast } from '@/lib/toast'

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
  paid: boolean
  datePaid: string | null
  comments: string
  outstanding: number
  outstandingDays: number
  status: 'Pendiente' | 'Vencida' | 'Pagada'
}

const money = (n: number) => n.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

const STATUS_STYLE: Record<InvoiceRow['status'], string> = {
  Pendiente: 'bg-gray-100 text-gray-600',
  Vencida: 'bg-red-100 text-red-700',
  Pagada: 'bg-green-100 text-green-700',
}

type SortCol = 'month' | 'customer' | 'total' | 'billed' | 'outstanding' | 'outstandingDays' | 'status'

export default function InvoicesTable() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ rows: InvoiceRow[]; blocks: { blockId: string; client: string }[] }>({
    queryKey: ['client-invoices'],
    queryFn: async () => {
      const res = await fetch('/api/invoices')
      if (!res.ok) throw new Error('Error al cargar facturas')
      return res.json()
    },
  })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const clientByBlockId = useMemo(() => new Map((data?.blocks ?? []).map((b) => [b.blockId, b.client])), [data])

  const [monthFilter, setMonthFilter] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortCol>('month')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [savingId, setSavingId] = useState<number | null>(null)

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
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Error al guardar')
      }
      await qc.invalidateQueries({ queryKey: ['client-invoices'] })
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    } finally {
      setSavingId(null)
    }
  }

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
              <th className="px-3 py-2.5 text-center">Paid</th>
              <th className="px-3 py-2.5 text-left">Date Paid</th>
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
              <tr><td colSpan={12} className="text-center py-8 text-gray-400">Sin facturas registradas</td></tr>
            ) : (
              sorted.map((r) => (
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
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={r.paid} onChange={(e) => patch(r.id, { paid: e.target.checked })} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.paid ? (
                      <input
                        type="date" defaultValue={r.datePaid ?? ''}
                        onBlur={(e) => e.target.value && e.target.value !== r.datePaid && patch(r.id, { datePaid: e.target.value })}
                        className="border-0 bg-transparent focus:bg-white focus:border focus:border-gray-300 rounded px-1"
                      />
                    ) : '—'}
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
