'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Plus, Lock } from 'lucide-react'

interface RoleItem {
  id: number
  name: string
  userCount: number
  isDefault: boolean
}

const HEADER_STYLE = { backgroundColor: '#0170B9' }

export default function RolesPage() {
  const queryClient = useQueryClient()
  const [newRoleName, setNewRoleName] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  const { data: roles = [], isLoading } = useQuery<RoleItem[]>({
    queryKey: ['admin-roles'],
    queryFn: () => fetch('/api/admin/roles').then((r) => r.json()),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/roles/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-roles'] }),
    onError: (err: Error) => alert(err.message),
  })

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newRoleName.trim()) return
    setError('')
    setAdding(true)

    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoleName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNewRoleName('')
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold" style={{ color: '#3a3a3a' }}>
          Roles
        </h1>
      </div>

      {/* Add role form */}
      <div className="bg-white rounded-xl shadow p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Agregar nuevo rol</h2>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="Nombre del rol (ej: supervisor)"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={adding || !newRoleName.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60"
            style={{ backgroundColor: '#0170B9' }}
          >
            <Plus className="w-4 h-4" />
            Agregar
          </button>
        </form>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {/* Roles table */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={HEADER_STYLE}>
              <th className="px-4 py-3 text-left text-white font-medium">Nombre</th>
              <th className="px-4 py-3 text-center text-white font-medium">Usuarios asignados</th>
              <th className="px-4 py-3 text-center text-white font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                  Cargando...
                </td>
              </tr>
            ) : (
              roles.map((role, i) => (
                <tr key={role.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-800">{role.name}</span>
                    {role.isDefault && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-gray-400">
                        <Lock className="w-3 h-3" /> predeterminado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">{role.userCount}</td>
                  <td className="px-4 py-3 text-center">
                    {!role.isDefault && (
                      <button
                        onClick={() => {
                          if (role.userCount > 0) {
                            alert('No se puede eliminar un rol que tiene usuarios asignados')
                            return
                          }
                          if (confirm(`¿Eliminar el rol "${role.name}"?`)) {
                            deleteMutation.mutate(role.id)
                          }
                        }}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
