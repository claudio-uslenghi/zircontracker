'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Eye, EyeOff, Search } from 'lucide-react'
import { toast } from '@/lib/toast'

interface PivotItem {
  id: number
  name: string
  invoicingHidden: boolean
  invoicingOrder: number | null
}

interface PivotData {
  projects: PivotItem[]
  resources: PivotItem[]
}

type Kind = 'project' | 'resource'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Error')
  return data
}

function Row({
  item, moving, canMoveUp, canMoveDown, onToggle, onMove,
}: {
  item: PivotItem
  moving: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onToggle: () => void
  onMove: (direction: 'up' | 'down') => void
}) {
  return (
    <div className={`flex items-center gap-2 text-sm py-1.5 border-b border-gray-50 last:border-0 ${item.invoicingHidden ? 'opacity-50' : ''}`}>
      {!item.invoicingHidden && (
        <div className="flex flex-col -my-1">
          <button onClick={() => onMove('up')} disabled={!canMoveUp || moving} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:hover:text-gray-300" aria-label="Subir">
            <ArrowUp size={12} />
          </button>
          <button onClick={() => onMove('down')} disabled={!canMoveDown || moving} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:hover:text-gray-300" aria-label="Bajar">
            <ArrowDown size={12} />
          </button>
        </div>
      )}
      <span className="flex-1 truncate text-gray-700">{item.name}</span>
      <button
        onClick={onToggle}
        className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium border min-h-[36px] ${
          item.invoicingHidden
            ? 'border-gray-300 text-gray-500 hover:bg-gray-50'
            : 'border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
        }`}
      >
        {item.invoicingHidden ? <><Eye size={13} /> Mostrar</> : <><EyeOff size={13} /> Ocultar</>}
      </button>
    </div>
  )
}

function PivotList({ kind, label, items, onChanged }: { kind: Kind; label: string; items: PivotItem[]; onChanged: () => void }) {
  const [query, setQuery] = useState('')
  const [movingId, setMovingId] = useState<number | null>(null)

  const visible = useMemo(() => items.filter((i) => !i.invoicingHidden), [items])
  const hidden = useMemo(() => items.filter((i) => i.invoicingHidden), [items])
  const q = query.trim().toLowerCase()
  const filteredVisible = q ? visible.filter((i) => i.name.toLowerCase().includes(q)) : visible
  const filteredHidden = q ? hidden.filter((i) => i.name.toLowerCase().includes(q)) : hidden

  const toggle = async (item: PivotItem) => {
    try {
      await api(`/api/admin/invoicing-pivot/${kind}s/${item.id}`, { method: 'PATCH', body: JSON.stringify({ hidden: !item.invoicingHidden }) })
      onChanged()
    } catch (e) {
      toast({ title: 'No se pudo cambiar', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    }
  }

  const move = async (item: PivotItem, direction: 'up' | 'down') => {
    setMovingId(item.id)
    try {
      await api(`/api/admin/invoicing-pivot/${kind}s/${item.id}/move`, { method: 'PATCH', body: JSON.stringify({ direction }) })
      onChanged()
    } catch (e) {
      toast({ title: 'No se pudo mover', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    } finally {
      setMovingId(null)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 sm:p-5 bg-white space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-semibold text-gray-700">{label}</span>
        <span className="text-xs text-gray-400">{visible.length} visible{visible.length !== 1 ? 's' : ''}{hidden.length > 0 ? `, ${hidden.length} oculto${hidden.length !== 1 ? 's' : ''}` : ''}</span>
      </div>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Buscar ${label.toLowerCase()}...`}
          className="w-full border border-gray-300 rounded pl-8 pr-3 py-2 text-sm"
        />
      </div>
      <div className="max-h-80 overflow-y-auto">
        {filteredVisible.length === 0 && filteredHidden.length === 0 && (
          <p className="text-xs text-gray-400 py-4 text-center">Sin resultados.</p>
        )}
        {filteredVisible.map((item, i) => (
          <Row
            key={item.id}
            item={item}
            moving={movingId === item.id}
            canMoveUp={i > 0}
            canMoveDown={i < filteredVisible.length - 1}
            onToggle={() => toggle(item)}
            onMove={(direction) => move(item, direction)}
          />
        ))}
        {filteredHidden.length > 0 && (
          <div className="pt-2 mt-2 border-t border-gray-100">
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Ocultos</p>
            {filteredHidden.map((item) => (
              <Row
                key={item.id}
                item={item}
                moving={false}
                canMoveUp={false}
                canMoveDown={false}
                onToggle={() => toggle(item)}
                onMove={() => {}}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Wizard step 1: replaces the old hardcoded INVOICING_PROJECT_ORDER /
// INVOICING_RESOURCE_ORDER lists (lib/invoicing-report.ts, deleted) with a
// real, admin-editable list. Ocultar/mostrar y el orden son persistentes —
// un proyecto/persona oculto no vuelve a aparecer solo el mes siguiente. Un
// Proyecto/Resource nuevo (creado en /projects o /resources) aparece acá
// visible por default, al final de la lista, listo para ocultar u ordenar.
export default function PivotConfig() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<PivotData>({
    queryKey: ['invoicing-pivot-config'],
    queryFn: () => api('/api/admin/invoicing-pivot'),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['invoicing-pivot-config'] })

  if (isLoading) return <p className="text-sm text-gray-400 py-8 text-center">Cargando...</p>

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Proyectos y personas que entran en &quot;Info para invoicing&quot; y en las facturas de cada mes. Ocultar algo acá
        lo saca de los meses futuros para siempre, hasta que lo vuelvas a mostrar — no afecta las facturas ya generadas.
        Lo nuevo (un proyecto o persona recién creado en el resto de la app) aparece acá visible por default.
      </p>
      <PivotList kind="project" label="Proyectos" items={data?.projects ?? []} onChanged={refresh} />
      <PivotList kind="resource" label="Personas" items={data?.resources ?? []} onChanged={refresh} />
    </div>
  )
}
