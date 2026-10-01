'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronRight } from 'lucide-react'
import SearchableSelect from '@/components/ui/SearchableSelect'
import InvoicesTable from '@/components/billing/InvoicesTable'
import InvoiceBlocksConfig from '@/components/billing/InvoiceBlocksConfig'
import PivotConfig from '@/components/billing/PivotConfig'
import { toast } from '@/lib/toast'
import {
  computeInvoice,
  getBlockTotals,
  hoursToQty,
  type InvoiceBlockDef,
  type LineState,
} from '@/lib/invoice-sheet'

function formatHours(h: number) {
  return h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)
}

const money = (n: number) =>
  n.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

interface InvoicingRow {
  id: number
  name: string
  total: number
  hasData: boolean
  hoursByProject: Record<number, number>
}

interface InvoicingCol {
  id: number
  name: string
  total: number
  hasData: boolean
}

interface InvoicingPreview {
  month: string
  resources: InvoicingRow[]
  projects: InvoicingCol[]
  warnings: string[]
}

interface InvoiceSheetData {
  month: string
  blocks: InvoiceBlockDef[]
  blockProjects: Record<string, string | null>
  lineDefaults: Record<string, string | null>
  hours: Record<string, Record<string, number>>
  resourceNames: string[]
  warnings: string[]
}

function buildInitialStates(data: InvoiceSheetData): Record<string, LineState> {
  const states: Record<string, LineState> = {}
  for (const block of data.blocks) {
    const project = data.blockProjects[block.id]
    for (const item of block.items) {
      if (item.type === 'line') {
        const person = item.person !== undefined ? data.lineDefaults[item.id] ?? null : null
        const fromHours = item.person !== undefined && !!project && !!person
        const qty = fromHours ? hoursToQty(block.unit, data.hours[person!]?.[project!] ?? 0) : item.qtyDefault ?? 0
        states[item.id] = { resourceName: person, rate: item.rate ?? 0, qty }
      } else if (item.type === 'discount') {
        states[item.id] = { resourceName: null, rate: item.rate, qty: 0 }
      }
    }
  }
  return states
}

// Paso 2: solo lectura — qué entra en el pivot ya quedó decidido en el paso 1
// (PivotConfig). Acá solo se revisa que las horas de todos estén cargadas.
function PivotSection({ preview }: { preview: InvoicingPreview }) {
  const withoutData = [...preview.resources, ...preview.projects].filter((x) => !x.hasData)
  return (
    <div className="border border-blue-200 rounded-lg p-5 bg-white space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-gray-700">Info para invoicing</span>
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Hoja 2 · Recurso × Proyecto</span>
      </div>
      <p className="text-xs text-gray-500">
        Solo lectura — qué proyectos y personas entran acá se define en el paso &quot;Proyectos y personas&quot;.
      </p>

      {withoutData.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 space-y-1">
          <div className="flex items-center gap-1 text-yellow-700 font-medium text-sm">
            <AlertTriangle size={14} /> Sin horas este mes
          </div>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {withoutData.map((x) => (
              <p key={x.id} className="text-xs text-yellow-800">&quot;{x.name}&quot; no tiene horas cargadas en {preview.month}.</p>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto max-h-72 border rounded">
        <table className="w-full text-xs">
          <thead className="bg-blue-600 text-white sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left sticky left-0 bg-blue-600">Recurso</th>
              <th className="px-2 py-2 text-right">Total</th>
              {preview.projects.map((p) => (
                <th key={p.id} className="px-2 py-2 text-right whitespace-nowrap">{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.resources.map((r) => (
              <tr key={r.id} className={`border-t hover:bg-gray-50 ${!r.hasData ? 'opacity-50' : ''}`}>
                <td className="px-2 py-1.5 sticky left-0 bg-white font-medium whitespace-nowrap">{r.name}</td>
                <td className="px-2 py-1.5 text-right font-semibold">{formatHours(r.total)}</td>
                {preview.projects.map((p) => (
                  <td key={p.id} className="px-2 py-1.5 text-right text-gray-600">
                    {r.hoursByProject[p.id] > 0 ? formatHours(r.hoursByProject[p.id]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InvoiceSection({
  data, states, setStates, onGoToConfig,
}: {
  data: InvoiceSheetData
  states: Record<string, LineState>
  setStates: (updater: (prev: Record<string, LineState>) => Record<string, LineState>) => void
  onGoToConfig: () => void
}) {
  const rows = useMemo(() => computeInvoice(data.blocks, states), [data.blocks, states])
  const blockById = useMemo(() => new Map(data.blocks.map((b) => [b.id, b])), [data.blocks])
  const personOptions = useMemo(
    () => [{ value: '', label: '— Sin persona —' }, ...data.resourceNames.map((n) => ({ value: n, label: n }))],
    [data.resourceNames]
  )

  const patch = (id: string, change: Partial<LineState>) =>
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...change } }))

  const changePerson = (id: string, blockId: string, name: string) => {
    const block = blockById.get(blockId)!
    const project = data.blockProjects[blockId]
    const qty = name && project && block ? hoursToQty(block.unit, data.hours[name]?.[project] ?? 0) : 0
    patch(id, { resourceName: name || null, qty })
  }

  const visibleRows = rows.filter((r) => r.kind !== 'blank')

  return (
    <div className="border border-green-200 rounded-lg p-5 bg-white space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-gray-700">Facturas por cliente</span>
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Hoja 1 · Precio × Horas = Total</span>
        </div>
        <button onClick={onGoToConfig} className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
          ¿Falta una línea o cambió un precio? Ir a Configurar clientes <ChevronRight size={12} />
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Las horas salen de las horas cargadas de la persona en el proyecto del cliente (enteros). Podés cambiar la persona,
        el precio o la cantidad de cada línea solo para este mes; el archivo lleva las fórmulas de la columna Total.
      </p>

      {data.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 space-y-1">
          <div className="flex items-center gap-1 text-yellow-700 font-medium text-sm">
            <AlertTriangle size={14} /> Avisos
          </div>
          {data.warnings.map((w, i) => (
            <p key={i} className="text-yellow-800 text-xs">{w}</p>
          ))}
        </div>
      )}

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-xs min-w-[900px]">
          <thead className="bg-green-600 text-white">
            <tr>
              <th className="px-2 py-2 text-left">Concepto</th>
              <th className="px-2 py-2 text-left w-48">Persona</th>
              <th className="px-2 py-2 text-right w-20">Precio</th>
              <th className="px-2 py-2 text-right w-20">Cant.</th>
              <th className="px-2 py-2 text-right w-24">Total</th>
              <th className="px-2 py-2 text-left w-44">Comentario</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              if (row.kind === 'title') {
                return (
                  <tr key={row.sheetRow} className="bg-gray-50 text-gray-500">
                    <td colSpan={6} className="px-2 py-1.5">{row.label}</td>
                  </tr>
                )
              }
              if (row.kind === 'header') {
                const project = row.blockId ? data.blockProjects[row.blockId] : null
                return (
                  <tr key={row.sheetRow} className="bg-green-50 font-semibold border-t">
                    <td className="px-2 py-1.5">{row.label}</td>
                    <td className="px-2 py-1.5 text-gray-500 font-normal">
                      {project ? `Proyecto: ${project}` : 'Sin proyecto en la base — cantidades a mano'}
                    </td>
                    <td className="px-2 py-1.5 text-right">{row.priceLabel}</td>
                    <td className="px-2 py-1.5 text-right">{row.qtyLabel}</td>
                    <td className="px-2 py-1.5 text-right">Total</td>
                    <td />
                  </tr>
                )
              }
              if (row.kind === 'text') {
                return (
                  <tr key={row.sheetRow} className="border-t text-gray-500">
                    <td colSpan={6} className="px-2 py-1.5">{row.label}</td>
                  </tr>
                )
              }
              const st = row.itemId ? states[row.itemId] : undefined
              const isSubtotal = row.kind === 'sum' || row.kind === 'vat'
              return (
                <tr key={row.sheetRow} className={`border-t ${isSubtotal ? 'bg-gray-50 font-semibold' : 'hover:bg-gray-50'}`}>
                  <td className="px-2 py-1.5">{row.label}</td>
                  <td className="px-2 py-1">
                    {row.kind === 'line' && row.hasPerson && row.itemId && row.blockId && (
                      <SearchableSelect
                        value={st?.resourceName ?? ''}
                        onChange={(v) => changePerson(row.itemId!, row.blockId!, v)}
                        options={personOptions}
                        placeholder="Elegí persona..."
                        className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {row.kind === 'line' && row.itemId ? (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={st?.rate ?? 0}
                        onChange={(e) => patch(row.itemId!, { rate: Number(e.target.value) || 0 })}
                        className="border border-gray-300 rounded px-1.5 py-1 text-xs w-20 text-right"
                      />
                    ) : row.kind === 'discount' && row.rate != null ? (
                      row.rate
                    ) : null}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {row.qtyEditable && row.itemId ? (
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={st?.qty ?? 0}
                        onChange={(e) => patch(row.itemId!, { qty: Math.round(Number(e.target.value)) || 0 })}
                        className="border border-gray-300 rounded px-1.5 py-1 text-xs w-20 text-right"
                      />
                    ) : row.qty != null ? (
                      row.qty
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.total != null ? money(row.total) : ''}</td>
                  <td className="px-2 py-1.5 text-gray-500">
                    {row.avgRate !== undefined ? `Tarifa prom.: ${money(row.avgRate)}` : row.comment}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GenerateSection({
  data, states, month, onGenerated,
}: {
  data: InvoiceSheetData
  states: Record<string, LineState>
  month: string
  onGenerated: (month: string) => void
}) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const rows = useMemo(() => computeInvoice(data.blocks, states), [data.blocks, states])
  const totals = useMemo(() => getBlockTotals(data.blocks, rows).filter((b) => b.total > 0), [data.blocks, rows])

  const handleExport = async () => {
    setExporting(true); setError('')
    try {
      const res = await fetch('/api/reports/invoicing/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, invoiceLines: states }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Error al generar el archivo')
      }
      const summary = res.headers.get('X-Invoice-Records-Summary')
      const sheetsSync = res.headers.get('X-Sheets-Sync-Status')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `invoicing-${month}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      if (summary) {
        const created = Number(summary.match(/created=(\d+)/)?.[1] ?? 0)
        const updated = Number(summary.match(/updated=(\d+)/)?.[1] ?? 0)
        toast({
          title: 'Facturas actualizadas',
          description: `${created} registro${created !== 1 ? 's' : ''} nuevo${created !== 1 ? 's' : ''}, ${updated} actualizado${updated !== 1 ? 's' : ''}.`,
          variant: 'success',
        })
      }
      if (sheetsSync === 'ok') {
        toast({ title: 'Google Sheets sincronizado', description: 'Se actualizaron los dos tabs del mes en la planilla real.', variant: 'success' })
      } else if (sheetsSync === 'skipped') {
        toast({ title: 'Google Sheets no sincronizado', description: 'No hay credenciales configuradas — solo se generó el .xlsx.', variant: 'warning' })
      } else if (sheetsSync?.startsWith('error:')) {
        const msg = decodeURIComponent(sheetsSync.slice('error:'.length))
        toast({ title: 'No se pudo sincronizar con Google Sheets', description: msg, variant: 'error' })
      }
      onGenerated(month)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-white space-y-4">
      <div>
        <span className="text-base font-semibold text-gray-700">Generar — {month}</span>
        <p className="text-xs text-gray-500 mt-1">
          Revisá el total por cliente antes de generar. Esto crea o actualiza las facturas del mes, descarga el .xlsx y
          sincroniza la planilla de Google Sheets.
        </p>
      </div>

      <div className="border rounded divide-y">
        {totals.length === 0 && <p className="text-xs text-gray-400 p-3">Ningún cliente tiene total &gt; 0 este mes.</p>}
        {totals.map((t) => (
          <div key={t.blockId} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-gray-700">{t.client}</span>
            <span className="font-semibold tabular-nums">{money(t.total)}</span>
          </div>
        ))}
        {totals.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 text-sm bg-gray-50 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(totals.reduce((s, t) => s + t.total, 0))}</span>
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">{error}</div>}

      <button
        onClick={handleExport}
        disabled={exporting}
        className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 text-sm flex items-center justify-center gap-2"
      >
        <Check size={16} /> {exporting ? 'Generando...' : `Generar facturas de ${month}`}
      </button>
    </div>
  )
}

const WIZARD_STEPS = [
  { n: 1, key: 'config', label: 'Configuración' },
  { n: 2, key: 'pivot', label: 'Info para invoicing' },
  { n: 3, key: 'invoice', label: 'Facturas por cliente' },
  { n: 4, key: 'generate', label: 'Generar' },
] as const

// Paso 1: ocultar/mostrar/reordenar Proyectos y Personas (PivotConfig, decide
// qué entra al pivot de horas) y la estructura de facturación por cliente
// (InvoiceBlocksConfig — bloques/líneas/tarifas, el mismo componente que usa
// la tab de primer nivel "Configurar clientes", reusado acá sin duplicar
// lógica). Dos modelos de datos distintos a propósito, conviven en el mismo
// paso porque las dos son "configuración" que un admin ajusta antes de
// generar — ver SPEC.md "fusionar Configurar clientes dentro del paso 1".
const STEP1_SUBTABS = [
  { key: 'projects', label: 'Proyectos y personas' },
  { key: 'clients', label: 'Clientes de facturación' },
] as const
type Step1Sub = (typeof STEP1_SUBTABS)[number]['key']

function Step1({ sub, onSubChange }: { sub: Step1Sub; onSubChange: (s: Step1Sub) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-gray-200 -mt-1">
        {STEP1_SUBTABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onSubChange(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              sub === t.key
                ? 'border-[#0170B9] text-[#0170B9]'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'projects' && <PivotConfig />}
      {sub === 'clients' && <InvoiceBlocksConfig />}
    </div>
  )
}

function WizardStepper({ step, onJump }: { step: number; onJump: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1">
      {WIZARD_STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onJump(s.n)}
            className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs sm:text-sm font-medium border transition-colors ${
              step === s.n ? 'bg-[#0170B9] text-white border-[#0170B9]' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0 ${step === s.n ? 'bg-white/20' : 'bg-gray-100'}`}>
              {s.n}
            </span>
            {s.label}
          </button>
          {i < WIZARD_STEPS.length - 1 && <div className="w-4 sm:w-8 h-px bg-gray-300 shrink-0" />}
        </div>
      ))}
    </div>
  )
}

function Wizard({ onGenerated }: { onGenerated: (month: string) => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const step = Math.min(4, Math.max(1, Number(searchParams.get('step') ?? '1') || 1))
  const month = searchParams.get('month') ?? defaultMonth
  const sub = (searchParams.get('sub') as Step1Sub) ?? 'projects'
  const [lineStates, setLineStates] = useState<Record<string, LineState>>({})

  const setParams = (patch: Record<string, string>) => {
    const sp = new URLSearchParams(searchParams.toString())
    Object.entries(patch).forEach(([k, v]) => sp.set(k, v))
    router.replace(`/admin/billing?${sp.toString()}`, { scroll: false })
  }

  const needsData = step >= 2
  const { data: pivot, isLoading: pivotLoading, error: pivotError } = useQuery<InvoicingPreview>({
    queryKey: ['billing-pivot', month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/invoicing?month=${month}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar el pivot')
      return data
    },
    enabled: needsData,
    retry: false,
  })
  const { data: invoiceSheet, isLoading: invoiceLoading, error: invoiceError } = useQuery<InvoiceSheetData>({
    queryKey: ['billing-invoice-sheet', month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/invoice-sheet?month=${month}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al cargar la hoja de facturas')
      return data
    },
    enabled: needsData,
    retry: false,
  })

  useEffect(() => {
    if (invoiceSheet) setLineStates(buildInitialStates(invoiceSheet))
  }, [invoiceSheet])

  const loading = pivotLoading || invoiceLoading
  const loadError = pivotError ?? invoiceError

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-lg p-4 sm:p-5 bg-white space-y-3">
        <WizardStepper step={step} onJump={(n) => setParams({ step: String(n) })} />
        {step >= 2 && (
          <div className="flex items-center gap-3 pt-1">
            <label className="text-sm text-gray-500">Mes</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setParams({ step: String(step), month: e.target.value })}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
        )}
      </div>

      {step === 1 && <Step1 sub={sub} onSubChange={(s) => setParams({ step: '1', sub: s })} />}

      {step >= 2 && loading && <p className="text-sm text-gray-400 py-8 text-center">Cargando...</p>}
      {step >= 2 && loadError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
          {loadError instanceof Error ? loadError.message : 'Error'}
        </div>
      )}

      {step === 2 && pivot && <PivotSection preview={pivot} />}

      {step === 3 && invoiceSheet && (
        <InvoiceSection
          data={invoiceSheet}
          states={lineStates}
          setStates={setLineStates}
          onGoToConfig={() => setParams({ step: '1', sub: 'clients' })}
        />
      )}

      {step === 4 && invoiceSheet && (
        <GenerateSection data={invoiceSheet} states={lineStates} month={month} onGenerated={onGenerated} />
      )}
    </div>
  )
}

type Tab = 'wizard' | 'invoices' | 'config'

function BillingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = (searchParams.get('tab') as Tab) ?? 'wizard'
  // La fuente de verdad es la URL, no un useState local — así el filtro de
  // mes en "Facturas" sobrevive un reload/link directo, no solo la
  // navegación SPA justo después de "Generar".
  const invoicesInitialMonth = searchParams.get('month') ?? undefined

  const setTab = (tab: Tab) => {
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('tab', tab)
    router.replace(`/admin/billing?${sp.toString()}`, { scroll: false })
  }

  const handleGenerated = () => {
    // El wizard ya deja `month` en la URL (step 4 lo necesita); solo hace
    // falta cambiar de tab, invoicesInitialMonth se deriva solo arriba.
    setTab('invoices')
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'wizard', label: 'Wizard' },
    { key: 'invoices', label: 'Facturas' },
    { key: 'config', label: 'Configurar clientes' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Facturación</h1>
        <p className="text-sm text-gray-500">Reportes mensuales para facturación e invoicing.</p>
      </div>

      <div className="border-b border-gray-200 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 sm:px-5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === t.key
                ? 'border-[#0170B9] text-[#0170B9]'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'wizard' && <Wizard onGenerated={handleGenerated} />}
      {activeTab === 'invoices' && <InvoicesTable initialMonth={invoicesInitialMonth} />}
      {activeTab === 'config' && <InvoiceBlocksConfig />}
    </div>
  )
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingPageInner />
    </Suspense>
  )
}
