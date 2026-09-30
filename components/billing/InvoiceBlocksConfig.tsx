'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm-dialog'

interface Resource { id: number; name: string }
interface Project { id: number; name: string }

interface LineItem {
  id: number
  refSlug: string
  order: number
  type: 'text' | 'blank' | 'line' | 'sum' | 'vat' | 'discount'
  label: string
  rate: number | null
  rateFormula: string | null
  hasPerson: boolean
  resourceId: number | null
  resource: Resource | null
  qtyDefault: number
  comment: string
  refs: string
  factor: number | null
  qtyIsSum: boolean
  avgRate: boolean
}

interface Block {
  id: number
  slug: string
  client: string
  customerName: string
  active: boolean
  order: number
  header: boolean
  okMark: boolean
  priceLabel: string
  qtyLabel: string
  unit: 'hours' | 'days'
  projectId: number | null
  project: Project | null
  paymentTermDays: number
  items: LineItem[]
}

const TYPE_LABEL: Record<LineItem['type'], string> = {
  text: 'Texto', blank: 'Espacio', line: 'Línea', sum: 'Subtotal', vat: 'IVA', discount: 'Descuento',
}
const TYPE_BADGE: Record<LineItem['type'], string> = {
  text: 'bg-gray-100 text-gray-500', blank: 'bg-gray-50 text-gray-400', line: 'bg-blue-100 text-blue-700',
  sum: 'bg-amber-100 text-amber-700', vat: 'bg-purple-100 text-purple-700', discount: 'bg-red-100 text-red-700',
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Error')
  return data
}

function BlockForm({
  projects, editingBlock, onDone, onCancel,
}: {
  projects: Project[]
  editingBlock?: Block
  onDone: () => void
  onCancel?: () => void
}) {
  const [client, setClient] = useState(editingBlock?.client ?? '')
  const [customerName, setCustomerName] = useState(editingBlock?.customerName ?? '')
  const [projectId, setProjectId] = useState<number | null>(editingBlock?.projectId ?? null)
  const [unit, setUnit] = useState<'hours' | 'days'>(editingBlock?.unit ?? 'hours')
  const [paymentTermDays, setPaymentTermDays] = useState(editingBlock?.paymentTermDays ?? 30)
  const [saving, setSaving] = useState(false)

  const projectOptions = useMemo(
    () => [{ value: '', label: '— Manual (sin proyecto) —' }, ...projects.map((p) => ({ value: String(p.id), label: p.name }))],
    [projects]
  )

  const submit = async () => {
    if (!client.trim()) return
    setSaving(true)
    try {
      if (editingBlock) {
        await api(`/api/admin/invoice-blocks/${editingBlock.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            client: client.trim(), customerName: customerName.trim() || client.trim(),
            projectId, unit, paymentTermDays,
            priceLabel: unit === 'days' ? 'Rate' : 'Precio', qtyLabel: unit === 'days' ? 'Days' : 'Horas',
          }),
        })
        toast({ title: 'Cliente actualizado', variant: 'success' })
      } else {
        await api('/api/admin/invoice-blocks', {
          method: 'POST',
          body: JSON.stringify({
            client: client.trim(), customerName: customerName.trim() || client.trim(),
            projectId, unit, paymentTermDays,
            priceLabel: unit === 'days' ? 'Rate' : 'Precio', qtyLabel: unit === 'days' ? 'Days' : 'Horas',
          }),
        })
        toast({ title: 'Cliente creado', description: `"${client.trim()}" — agregale líneas para empezar a facturarlo.`, variant: 'success' })
      }
      onDone()
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-blue-200 rounded-lg p-4 bg-blue-50/40 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cliente (nombre del bloque)</label>
          <input value={client} onChange={(e) => setClient(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="Ej: Acme Corp" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Customer (nombre legal para la factura)</label>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="Si difiere del nombre del bloque" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Proyecto vinculado (horas automáticas)</label>
          <SearchableSelect
            value={projectId != null ? String(projectId) : ''}
            onChange={(v) => setProjectId(v ? Number(v) : null)}
            options={projectOptions}
            placeholder="Elegí un proyecto..."
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Unidad</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'hours' | 'days')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
              <option value="hours">Horas</option>
              <option value="days">Días</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Término de pago (días)</label>
            <input type="number" min={0} value={paymentTermDays} onChange={(e) => setPaymentTermDays(Number(e.target.value) || 0)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving || !client.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
          {saving ? 'Guardando...' : editingBlock ? 'Guardar cambios' : 'Crear cliente'}
        </button>
        {onCancel && <button onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancelar</button>}
      </div>
    </div>
  )
}

function NewBlockButton({ projects, onCreated }: { projects: Project[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
      >
        <Plus size={15} /> Nuevo proyecto/cliente
      </button>
    )
  }
  return <BlockForm projects={projects} onDone={() => { setOpen(false); onCreated() }} onCancel={() => setOpen(false)} />
}

function LineForm({
  block, editingItem, onDone, onCancel,
}: {
  block: Block
  editingItem?: LineItem
  onDone: () => void
  onCancel: () => void
}) {
  const isEdit = !!editingItem
  const [type, setType] = useState<'line' | 'sum' | 'vat' | 'discount'>((editingItem?.type as 'line' | 'sum' | 'vat' | 'discount') ?? 'line')
  const [label, setLabel] = useState(editingItem?.label ?? '')
  const [rate, setRate] = useState<number | ''>(editingItem?.rate ?? '')
  const [hasPerson, setHasPerson] = useState(editingItem?.hasPerson ?? false)
  const [resourceId, setResourceId] = useState<number | null>(editingItem?.resourceId ?? null)
  const [qtyDefault, setQtyDefault] = useState(editingItem?.qtyDefault ?? 0)
  const [comment, setComment] = useState(editingItem?.comment ?? '')
  const [refs, setRefs] = useState<string[]>(editingItem?.refs ? editingItem.refs.split(',') : [])
  const [factor, setFactor] = useState<number | ''>(editingItem?.factor ?? '')
  const [qtyIsSum, setQtyIsSum] = useState(editingItem?.qtyIsSum ?? false)
  const [avgRate, setAvgRate] = useState(editingItem?.avgRate ?? false)
  // Checked by default (per spec) so a new line doesn't silently sit outside
  // every existing Subtotal the way Andre Conrado's "Dev" line did.
  const [includeInSums, setIncludeInSums] = useState<number[]>(() =>
    block.items.filter((i) => i.type === 'sum' && i.id !== editingItem?.id).map((i) => i.id)
  )
  const [saving, setSaving] = useState(false)

  const { data: resources } = useQuery<Resource[]>({
    queryKey: ['resources-for-invoice-lines'],
    queryFn: () => api<Resource[]>('/api/resources'),
  })
  const resourceOptions = useMemo(
    () => [{ value: '', label: '— Sin persona por defecto —' }, ...(resources ?? []).map((r) => ({ value: String(r.id), label: r.name }))],
    [resources]
  )
  // Only earlier rows can be a sum/vat/discount's base — the calc engine
  // processes top to bottom and a forward reference is silently dropped.
  const referenceable = block.items.filter(
    (i) => (i.type === 'line' || i.type === 'sum') && (!editingItem || i.order < editingItem.order)
  )
  const existingSums = block.items.filter((i) => i.type === 'sum' && i.id !== editingItem?.id)

  const toggleRef = (slug: string) => {
    if (type === 'vat' || type === 'discount') { setRefs([slug]); return }
    setRefs((prev) => (prev.includes(slug) ? prev.filter((r) => r !== slug) : [...prev, slug]))
  }
  const toggleIncludeInSum = (id: number) => setIncludeInSums((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const submit = async () => {
    if (!label.trim()) return
    setSaving(true)
    try {
      const payload = {
        type, label: label.trim(),
        rate: type === 'line' && rate !== '' ? rate : null,
        hasPerson: type === 'line' ? hasPerson : false,
        resourceId: type === 'line' && hasPerson ? resourceId : null,
        qtyDefault: type === 'line' ? qtyDefault : 0,
        comment: comment.trim(),
        refs,
        factor: (type === 'vat' || type === 'discount') && factor !== '' ? factor : null,
        qtyIsSum, avgRate,
      }
      if (isEdit) {
        await api(`/api/admin/invoice-blocks/${block.id}/items/${editingItem.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await api(`/api/admin/invoice-blocks/${block.id}/items`, { method: 'POST', body: JSON.stringify({ ...payload, includeInSums }) })
      }
      onDone()
    } catch (e) {
      toast({ title: 'No se pudo guardar la línea', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded p-3 bg-gray-50 space-y-2 mt-2">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Tipo</label>
          <select
            value={type}
            disabled={isEdit}
            onChange={(e) => { setType(e.target.value as typeof type); setRefs([]) }}
            className={`border border-gray-300 rounded px-2 py-1 text-xs ${isEdit ? 'bg-gray-100 text-gray-500' : 'bg-white'}`}
          >
            <option value="line">Línea simple</option>
            <option value="sum">Subtotal (suma de líneas)</option>
            <option value="vat">IVA (% de un subtotal)</option>
            <option value="discount">Descuento (resta de un total)</option>
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
        </div>
        {type === 'line' && (
          <>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Precio</label>
              <input type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value === '' ? '' : Number(e.target.value))} className="w-24 border border-gray-300 rounded px-2 py-1 text-xs text-right" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Cant. por defecto</label>
              <input type="number" value={qtyDefault} onChange={(e) => setQtyDefault(Number(e.target.value) || 0)} className="w-24 border border-gray-300 rounded px-2 py-1 text-xs text-right" />
            </div>
          </>
        )}
        {(type === 'vat' || type === 'discount') && (
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-0.5">{type === 'vat' ? 'Factor (ej. 1.22)' : 'Porcentaje'}</label>
            <input type="number" step="any" value={factor} onChange={(e) => setFactor(e.target.value === '' ? '' : Number(e.target.value))} className="w-24 border border-gray-300 rounded px-2 py-1 text-xs text-right" />
          </div>
        )}
      </div>

      {type === 'line' && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={hasPerson} onChange={(e) => { setHasPerson(e.target.checked); if (!e.target.checked) setResourceId(null) }} />
            Tiene persona
          </label>
          {hasPerson && (
            <SearchableSelect
              value={resourceId != null ? String(resourceId) : ''}
              onChange={(v) => setResourceId(v ? Number(v) : null)}
              options={resourceOptions}
              placeholder="Persona por defecto..."
              className="border border-gray-300 rounded px-2 py-1 text-xs w-52"
            />
          )}
        </div>
      )}

      {!isEdit && type === 'line' && existingSums.length > 0 && (
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Incluir en el total</label>
          <div className="flex flex-wrap gap-2">
            {existingSums.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={includeInSums.includes(s.id)} onChange={() => toggleIncludeInSum(s.id)} />
                {s.label || 'Subtotal'}
              </label>
            ))}
          </div>
        </div>
      )}

      {type === 'sum' && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={qtyIsSum} onChange={(e) => setQtyIsSum(e.target.checked)} /> Sumar también cantidad
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={avgRate} onChange={(e) => setAvgRate(e.target.checked)} /> Mostrar tarifa promedio
          </label>
        </div>
      )}

      {(type === 'sum' || type === 'vat' || type === 'discount') && (
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">
            {type === 'sum' ? 'Líneas a sumar' : type === 'vat' ? 'Subtotal base' : 'Total que reduce'}
          </label>
          {referenceable.length === 0 ? (
            <p className="text-xs text-gray-400">No hay líneas anteriores para referenciar.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {referenceable.map((it) => (
                <label key={it.refSlug} className={`flex items-center gap-1 text-xs border rounded px-2 py-1 cursor-pointer ${refs.includes(it.refSlug) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600'}`}>
                  <input
                    type={type === 'sum' ? 'checkbox' : 'radio'}
                    checked={refs.includes(it.refSlug)}
                    onChange={() => toggleRef(it.refSlug)}
                    className="hidden"
                  />
                  {it.label || `(${TYPE_LABEL[it.type]})`}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Comentario</label>
        <input value={comment} onChange={(e) => setComment(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
      </div>

      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-40">
          {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Agregar'}
        </button>
        <button onClick={onCancel} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">Cancelar</button>
      </div>
    </div>
  )
}

function ItemRow({
  block, item, isFirst, isLast, onChanged,
}: {
  block: Block
  item: LineItem
  isFirst: boolean
  isLast: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState(false)

  const move = async (direction: 'up' | 'down') => {
    setMoving(true)
    try {
      await api(`/api/admin/invoice-blocks/${block.id}/items/${item.id}/move`, { method: 'PATCH', body: JSON.stringify({ direction }) })
      onChanged()
    } catch (e) {
      toast({ title: 'No se pudo mover', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    } finally {
      setMoving(false)
    }
  }

  const removeItem = async () => {
    const ok = await confirmDialog({
      title: `¿Borrar la línea "${item.label || '(sin label)'}"?`,
      description: 'No se puede deshacer. Si otra línea la usa como base de un subtotal, el borrado se va a rechazar.',
    })
    if (!ok) return
    try {
      await api(`/api/admin/invoice-blocks/${block.id}/items/${item.id}`, { method: 'DELETE' })
      onChanged()
    } catch (e) {
      toast({ title: 'No se pudo borrar la línea', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    }
  }

  if (editing) {
    return <LineForm block={block} editingItem={item} onDone={() => { setEditing(false); onChanged() }} onCancel={() => setEditing(false)} />
  }

  return (
    <div className="flex items-center gap-2 text-xs py-1 border-b border-gray-50 last:border-0">
      <div className="flex flex-col -my-1">
        <button onClick={() => move('up')} disabled={isFirst || moving} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:hover:text-gray-300">
          <ArrowUp size={11} />
        </button>
        <button onClick={() => move('down')} disabled={isLast || moving} className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:hover:text-gray-300">
          <ArrowDown size={11} />
        </button>
      </div>
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TYPE_BADGE[item.type]}`}>{TYPE_LABEL[item.type]}</span>
      <span className="flex-1 truncate text-gray-700">{item.label || <em className="text-gray-400">(sin label)</em>}</span>
      {item.type === 'line' && <span className="text-gray-500 tabular-nums">{item.rate ?? '—'}</span>}
      {item.hasPerson && <span className="text-gray-400">{item.resource?.name ?? '— sin persona —'}</span>}
      {(item.type === 'vat' || item.type === 'discount') && <span className="text-gray-500 tabular-nums">{item.factor}</span>}
      <button onClick={() => setEditing(true)} className="text-gray-300 hover:text-blue-500">
        <Pencil size={12} />
      </button>
      <button onClick={removeItem} className="text-gray-300 hover:text-red-500">
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function BlockRow({ block, projects, onChanged }: { block: Block; projects: Project[]; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [editingBlock, setEditingBlock] = useState(false)
  const [addingLine, setAddingLine] = useState(false)

  const toggleActive = async () => {
    if (block.active) {
      const ok = await confirmDialog({
        title: `¿Ocultar "${block.client}"?`,
        description: 'Sale de la generación de meses futuros. Sus facturas históricas no se tocan, y se puede reactivar cuando quieras.',
        confirmLabel: 'Ocultar',
        variant: 'destructive',
      })
      if (!ok) return
    }
    try {
      await api(`/api/admin/invoice-blocks/${block.id}`, { method: 'PATCH', body: JSON.stringify({ active: !block.active }) })
      onChanged()
    } catch (e) {
      toast({ title: 'No se pudo actualizar', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    }
  }

  const remove = async () => {
    const ok = await confirmDialog({
      title: `¿Borrar "${block.client}" definitivamente?`,
      description: 'No se puede deshacer. Solo funciona si este cliente nunca generó una factura — si tiene historial, usá "Ocultar" en su lugar.',
      confirmLabel: 'Borrar',
    })
    if (!ok) return
    try {
      await api(`/api/admin/invoice-blocks/${block.id}`, { method: 'DELETE' })
      toast({ title: 'Cliente eliminado', variant: 'success' })
      onChanged()
    } catch (e) {
      toast({ title: 'No se pudo eliminar', description: e instanceof Error ? e.message : 'Error', variant: 'error' })
    }
  }

  const items = block.items.filter((i) => i.type !== 'text' && i.type !== 'blank')

  return (
    <div className={`border rounded-lg bg-white ${block.active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
      <div className="flex items-center gap-2 p-3">
        <button onClick={() => setExpanded((e) => !e)} className="text-gray-400 hover:text-gray-600">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-800">{block.client}</span>
            {!block.active && <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">Oculto</span>}
            <span className="text-xs text-gray-400">{block.project ? `Proyecto: ${block.project.name}` : 'Manual'}</span>
            <span className="text-xs text-gray-400">· {block.paymentTermDays}d de plazo</span>
          </div>
          <p className="text-xs text-gray-500">{block.customerName}</p>
        </div>
        <button onClick={() => setEditingBlock((v) => !v)} className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600">
          Editar
        </button>
        <button onClick={toggleActive} className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600">
          {block.active ? 'Ocultar' : 'Reactivar'}
        </button>
        <button
          onClick={remove}
          title="Solo se puede borrar si nunca generó una factura"
          className="text-xs px-2 py-1 border border-red-200 text-red-500 rounded hover:bg-red-50"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {editingBlock && (
        <div className="border-t border-gray-100 p-3">
          <BlockForm projects={projects} editingBlock={block} onDone={() => { setEditingBlock(false); onChanged() }} onCancel={() => setEditingBlock(false)} />
        </div>
      )}
      {expanded && (
        <div className="border-t border-gray-100 p-3 space-y-1">
          {items.length === 0 ? (
            <p className="text-xs text-gray-400">Sin líneas todavía.</p>
          ) : (
            items.map((item, i) => (
              <ItemRow key={item.id} block={block} item={item} isFirst={i === 0} isLast={i === items.length - 1} onChanged={onChanged} />
            ))
          )}
          {addingLine ? (
            <LineForm block={block} onDone={() => { setAddingLine(false); onChanged() }} onCancel={() => setAddingLine(false)} />
          ) : (
            <button onClick={() => setAddingLine(true)} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-2">
              <Plus size={13} /> Agregar línea
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function InvoiceBlocksConfig() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ blocks: Block[] }>({
    queryKey: ['invoice-blocks-admin'],
    queryFn: () => api('/api/admin/invoice-blocks'),
  })
  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects-for-invoice-blocks'],
    queryFn: () => api<Project[]>('/api/projects'),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['invoice-blocks-admin'] })
  const blocks = data?.blocks ?? []
  const active = blocks.filter((b) => b.active)
  const hidden = blocks.filter((b) => !b.active)

  if (isLoading) return <p className="text-sm text-gray-400 py-8 text-center">Cargando...</p>

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Clientes/proyectos que se facturan cada mes en &quot;Facturas por cliente&quot;. Ocultar un cliente lo saca de la
        generación futura sin borrar sus facturas históricas.
      </p>
      <NewBlockButton projects={projects ?? []} onCreated={refresh} />
      <div className="space-y-2">
        {active.map((b) => <BlockRow key={b.id} block={b} projects={projects ?? []} onChanged={refresh} />)}
      </div>
      {hidden.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Ocultos</p>
          {hidden.map((b) => <BlockRow key={b.id} block={b} projects={projects ?? []} onChanged={refresh} />)}
        </div>
      )}
    </div>
  )
}
