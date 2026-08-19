'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import ResourceModal from '@/components/modals/ResourceModal'
import type { Resource } from '@/types'

export default function ResourcesPage() {
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editResource, setEditResource] = useState<Resource | null>(null)

  const { data: resources = [], isLoading } = useQuery<Resource[]>({
    queryKey: ['resources'],
    queryFn: () => fetch('/api/resources').then((r) => r.json()),
  })

  const deleteResource = async (id: number) => {
    if (!confirm('¿Eliminar este recurso y todas sus asignaciones?')) return
    await fetch(`/api/resources/${id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['resources'] })
    qc.invalidateQueries({ queryKey: ['gantt'] })
  }

  const COUNTRY_FLAG: Record<string, string> = {
    Argentina: '🇦🇷',
    Uruguay: '🇺🇾',
    Chile: '🇨🇱',
    Otro: '🌍',
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Recursos</h1>
          <p className="text-sm text-gray-500 mt-0.5">{resources.length} recursos registrados</p>
        </div>
        <button
          onClick={() => { setEditResource(null); setShowModal(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-[#0170B9] text-white rounded-lg hover:bg-[#005a94] transition-colors text-sm font-medium"
        >
          <Plus size={16} />
          Nuevo Recurso
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-400 py-12">Cargando recursos...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {resources.map((r) => (
            <div
              key={r.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg"
                    style={{ backgroundColor: r.color }}
                  >
                    {r.name[0]}
                  </div>
                  <div>
                    <div className="font-bold text-gray-800">{r.name}</div>
                    <div className="text-xs text-gray-500">
                      {COUNTRY_FLAG[r.country] ?? '🌍'} {r.country}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setEditResource(r); setShowModal(true) }}
                    className="text-blue-400 hover:text-blue-600 p-1 rounded transition-colors"
                    title="Editar"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => deleteResource(r.id)}
                    className="text-red-400 hover:text-red-600 p-1 rounded transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-500">
                <span>⏱ {r.capacityH}h/día</span>
                <span
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ backgroundColor: r.color }}
                  title={`Color: ${r.color}`}
                />
                <span className="text-gray-400">{r.color}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <ResourceModal
        open={showModal}
        editResource={editResource}
        onClose={() => { setShowModal(false); setEditResource(null) }}
      />
    </div>
  )
}
