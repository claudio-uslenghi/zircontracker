'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, Search, X } from 'lucide-react'
import ProjectModal from '@/components/modals/ProjectModal'
import { formatDate } from '@/lib/date-utils'
import type { Project } from '@/types'

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

export default function ProjectsPage() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const isAdmin = ((session?.user as { roles?: string[] })?.roles ?? []).includes('admin')
  const [showModal, setShowModal]     = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [sortKey, setSortKey]           = useState<SortKey>('name')
  const [sortDir, setSortDir]           = useState<SortDir>('asc')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [nameFilter, setNameFilter]     = useState('')

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects').then((r) => r.json()),
  })

  const deleteProject = async (id: number) => {
    if (!confirm('¿Eliminar este proyecto y todas sus asignaciones?')) return
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['gantt'] })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
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
    <th
      className={`px-4 py-3 cursor-pointer select-none whitespace-nowrap hover:bg-[#005a94] transition-colors ${className}`}
      onClick={() => handleSort(col)}
    >
      {label}<SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
    </th>
  )

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Cartera de Proyectos</h1>
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
            placeholder="Buscar proyecto..."
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            className="pl-8 pr-7 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-[#0170B9] w-52"
          />
          {nameFilter && (
            <button onClick={() => setNameFilter('')} className="absolute right-2 text-gray-400 hover:text-gray-600">
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
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                        <span className="font-medium">{p.name}</span>
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
                      {p.costPerHour > 0 ? `$${p.costPerHour}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {p.costPerHour > 0 ? `$${(p.estimatedHours * p.costPerHour).toLocaleString()}` : '—'}
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
                            title="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => deleteProject(p.id)}
                            className="text-red-400 hover:text-red-600 transition-colors"
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
                    {totalCost > 0 ? `$${totalCost.toLocaleString()}` : '—'}
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
