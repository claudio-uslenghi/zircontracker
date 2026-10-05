'use client'

import { Suspense, useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, Search, X } from 'lucide-react'
import ProjectModal from '@/components/modals/ProjectModal'
import { formatDate } from '@/lib/date-utils'
import { confirmDialog } from '@/lib/confirm-dialog'
import type { Project } from '@/types'

const currencyFormatter = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 2 })

const STATUS_COLORS: Record<string, string> = {
  'En ejecución':    '#C6EFCE',
  'Próximo':         '#FFEB9C',
  'En planificación':'#FFC7CE',
  'Continuo':        '#FCE4D6',
  'Finalizado':      '#E0E0E0',
}

const PRIORITY_COLORS: Record<string, string> = {
  Alta:  '#C00000',
  Media: '#BF8F00',
  Baja:  '#375623',
}

const ALL_STATUSES = ['En ejecución', 'En planificación', 'Próximo', 'Continuo', 'Finalizado']

type SortKey = 'name' | 'status' | 'priority' | 'startDate' | 'endDate' | 'estimatedHours' | 'costPerHour' | 'totalCost'
type SortDir = 'asc' | 'desc'

const PRIORITY_ORDER: Record<string, number> = { Alta: 0, Media: 1, Baja: 2 }

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} className="opacity-40 ml-1 inline" />
  return sortDir === 'asc'
    ? <ChevronUp size={13} className="ml-1 inline" />
    : <ChevronDown size={13} className="ml-1 inline" />
}

function ProjectsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()
  const { data: session } = useSession()
  const isAdmin = ((session?.user as { roles?: string[] })?.roles ?? []).includes('admin')
  const [showModal, setShowModal]     = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)

  // Filtros/orden reflejados en la URL (deep-linkable, sobreviven un
  // reload) — sortKey/sortDir/statusFilter son clicks, se escriben directo;
  // nameFilter es texto libre, se guarda en estado local para que tipear no
  // dependa del round-trip del router, y se empuja a la URL como efecto.
  const sortKey = (searchParams.get('sort') as SortKey) ?? 'name'
  const sortDir = (searchParams.get('dir') as SortDir) ?? 'asc'
  const statusFilter = searchParams.get('status') ?? 'active'
  const [nameFilter, setNameFilterState] = useState(searchParams.get('q') ?? '')

  const setParams = (patch: Record<string, string>) => {
    const sp = new URLSearchParams(searchParams.toString())
    Object.entries(patch).forEach(([k, v]) => (v ? sp.set(k, v) : sp.delete(k)))
    router.replace(`/projects?${sp.toString()}`, { scroll: false })
  }
  const setStatusFilter = (status: string) => setParams({ status })
  const setNameFilter = (q: string) => { setNameFilterState(q); setParams({ q }) }

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects').then((r) => r.json()),
  })

  const deleteProject = async (id: number) => {
    const ok = await confirmDialog({
      title: '¿Eliminar este proyecto?',
      description: 'Se eliminarán también todas sus asignaciones. Esta acción no se puede deshacer.',
    })
    if (!ok) return
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['gantt'] })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setParams({ dir: sortDir === 'asc' ? 'desc' : 'asc' })
    else setParams({ sort: key, dir: 'asc' })
  }

  const filtered = useMemo(() => {
    let list = [...projects]
    if (statusFilter === 'active') {
      list = list.filter(p => p.status !== 'Finalizado')
    } else if (statusFilter !== 'all') {
      list = list.filter(p => p.status === statusFilter)
    }
    if (nameFilter.trim()) {
      const q = nameFilter.trim().toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      let va: string | number, vb: string | number
      switch (sortKey) {
        case 'name':         va = a.name.toLowerCase();        vb = b.name.toLowerCase();        break
        case 'status':       va = a.status;                    vb = b.status;                    break
        case 'priority':     va = PRIORITY_ORDER[a.priority] ?? 9; vb = PRIORITY_ORDER[b.priority] ?? 9; break
        case 'startDate':    va = a.startDate;                 vb = b.startDate;                 break
        case 'endDate':      va = a.endDate;                   vb = b.endDate;                   break
        case 'estimatedHours': va = a.estimatedHours;          vb = b.estimatedHours;            break
        case 'costPerHour':  va = a.costPerHour;               vb = b.costPerHour;               break
        case 'totalCost':    va = a.estimatedHours * a.costPerHour; vb = b.estimatedHours * b.costPerHour; break
        default:             va = 0; vb = 0
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ?  1 : -1
      return 0
    })
    return list
  }, [projects, statusFilter, nameFilter, sortKey, sortDir])

  const totalHours = filtered.reduce((s, p) => s + p.estimatedHours, 0)
  const totalCost  = filtered.reduce((s, p) => s + p.estimatedHours * p.costPerHour, 0)

  const Th = ({ col, label, className = '' }: { col: SortKey; label: string; className?: string }) => (
    <th className={`p-0 whitespace-nowrap ${className}`}>
      <button
        type="button"
        onClick={() => handleSort(col)}
        className={`w-full h-full px-4 py-3 select-none hover:bg-[#005a94] focus-visible:bg-[#005a94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:-outline-offset-2 transition-colors ${
          className.includes('text-right') ? 'text-right' : 'text-left'
        }`}
      >
        {label}<SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
      </button>
    </th>
  )

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Cartera de Proyectos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {filtered.length} de {projects.length} proyectos
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setEditProject(null); setShowModal(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-[#0170B9] text-white rounded-lg hover:bg-[#005a94] transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            Nuevo Proyecto
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        {/* Name search */}
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-2.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            name="project-search"
            autoComplete="off"
            placeholder="Buscar proyecto..."
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            className="pl-8 pr-7 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0170B9] w-52"
          />
          {nameFilter && (
            <button onClick={() => setNameFilter('')} aria-label="Limpiar búsqueda" className="absolute right-2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>

        <div className="w-px h-5 bg-gray-200" />
        <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-gray-600">Estado:</span>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === 'active'
                ? 'bg-[#0170B9] text-white border-[#0170B9]'
                : 'bg-white text-gray-600 border-gray-300 hover:border-[#0170B9]'
            }`}
          >
            Activos
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === 'all'
                ? 'bg-[#0170B9] text-white border-[#0170B9]'
                : 'bg-white text-gray-600 border-gray-300 hover:border-[#0170B9]'
            }`}
          >
            Todos
          </button>
          {ALL_STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === s
                  ? 'bg-[#0170B9] text-white border-[#0170B9]'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-[#0170B9]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-400 py-12">Cargando proyectos...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0170B9] text-white text-left">
                  <Th col="name"           label="Proyecto" />
                  <Th col="status"         label="Estado" />
                  <Th col="priority"       label="Prioridad" />
                  <Th col="startDate"      label="F.Inicio" />
                  <Th col="endDate"        label="F.Fin" />
                  <Th col="estimatedHours" label="H.Est." className="text-right" />
                  <Th col="costPerHour"    label="$/h"    className="text-right" />
                  <Th col="totalCost"      label="Costo Total" className="text-right" />
                  <th className="px-4 py-3">Notas</th>
                  {isAdmin && <th className="px-4 py-3 text-center">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 10 : 9} className="px-4 py-10 text-center text-gray-400">
                      No hay proyectos que coincidan con el filtro
                    </td>
                  </tr>
                ) : filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 max-w-[240px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                        <span className="font-medium truncate">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{ backgroundColor: STATUS_COLORS[p.status] ?? '#eee' }}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold" style={{ color: PRIORITY_COLORS[p.priority] ?? '#333' }}>
                        {p.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(p.startDate)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(p.endDate)}</td>
                    <td className="px-4 py-3 text-right font-medium">{p.estimatedHours}h</td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {p.costPerHour > 0 ? `$${currencyFormatter.format(p.costPerHour)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {p.costPerHour > 0 ? `$${currencyFormatter.format(p.estimatedHours * p.costPerHour)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate" title={p.notes}>
                      {p.notes || '—'}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => { setEditProject(p); setShowModal(true) }}
                            className="text-blue-500 hover:text-blue-700 transition-colors"
                            aria-label={`Editar ${p.name}`}
                            title="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => deleteProject(p.id)}
                            className="text-red-400 hover:text-red-600 transition-colors"
                            aria-label={`Eliminar ${p.name}`}
                            title="Eliminar"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-300">
                  <td colSpan={5} className="px-4 py-3 text-gray-600">
                    TOTALES ({filtered.length} proyectos)
                  </td>
                  <td className="px-4 py-3 text-right">{totalHours}h</td>
                  <td />
                  <td className="px-4 py-3 text-right">
                    {totalCost > 0 ? `$${currencyFormatter.format(totalCost)}` : '—'}
                  </td>
                  <td colSpan={isAdmin ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <ProjectModal
        open={showModal}
        editProject={editProject}
        onClose={() => { setShowModal(false); setEditProject(null) }}
      />
    </div>
  )
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsPageInner />
    </Suspense>
  )
}
