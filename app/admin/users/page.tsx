'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Pencil, Trash2, Plus, UserCheck, UserX, Eye, EyeOff } from 'lucide-react'

interface Role {
  id: number
  name: string
}

interface UserItem {
  id: number
  email: string
  name: string
  active: boolean
  roles: Role[]
}

const HEADER_STYLE = { backgroundColor: '#0170B9' }

function UserModal({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user?: UserItem
  roles: Role[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!user
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [active, setActive] = useState(user?.active ?? true)
  const [selectedRoles, setSelectedRoles] = useState<number[]>(
    user?.roles.map((r) => r.id) ?? []
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function toggleRole(id: number) {
    setSelectedRoles((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const body: Record<string, unknown> = { name, email, roleIds: selectedRoles }
      if (isEdit) {
        body.active = active
        if (password) body.password = password
      } else {
        body.password = password
      }

      const res = await fetch(
        isEdit ? `/api/admin/users/${user!.id}` : '/api/admin/users',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error')

      onSaved()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          {isEdit ? 'Editar usuario' : 'Nuevo usuario'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isEdit ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required={!isEdit}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="active" className="text-sm text-gray-700">
                Usuario activo
              </label>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Roles</label>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRole(r.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    selectedRoles.includes(r.id)
                      ? 'text-white border-transparent'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                  }`}
                  style={
                    selectedRoles.includes(r.id) ? { backgroundColor: '#0170B9' } : {}
                  }
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 border border-gray-300 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-60"
              style={{ backgroundColor: '#0170B9' }}
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const [modal, setModal] = useState<{ open: boolean; user?: UserItem }>({ open: false })

  const { data: users = [], isLoading } = useQuery<UserItem[]>({
    queryKey: ['admin-users'],
    queryFn: () => fetch('/api/admin/users').then((r) => r.json()),
  })

  const { data: roles = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['admin-roles'],
    queryFn: () => fetch('/api/admin/roles').then((r) => r.json()),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/users/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const currentUserId = (session?.user as { id?: string })?.id

  function handleDelete(user: UserItem) {
    if (String(user.id) === currentUserId) {
      alert('No podés eliminarte a vos mismo')
      return
    }
    if (confirm(`¿Eliminar usuario "${user.name}"?`)) {
      deleteMutation.mutate(user.id)
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold" style={{ color: '#3a3a3a' }}>
          Usuarios
        </h1>
        <button
          onClick={() => setModal({ open: true })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium"
          style={{ backgroundColor: '#0170B9' }}
        >
          <Plus className="w-4 h-4" />
          Nuevo usuario
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={HEADER_STYLE}>
              <th className="px-4 py-3 text-left text-white font-medium">Nombre</th>
              <th className="px-4 py-3 text-left text-white font-medium">Email</th>
              <th className="px-4 py-3 text-left text-white font-medium">Roles</th>
              <th className="px-4 py-3 text-center text-white font-medium">Estado</th>
              <th className="px-4 py-3 text-center text-white font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Cargando...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No hay usuarios
                </td>
              </tr>
            ) : (
              users.map((user, i) => (
                <tr
                  key={user.id}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-4 py-3 font-medium text-gray-800">{user.name}</td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((r) => (
                        <span
                          key={r.id}
                          className="px-2 py-0.5 rounded-full text-xs text-white"
                          style={{ backgroundColor: '#0170B9' }}
                        >
                          {r.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {user.active ? (
                      <span className="flex items-center justify-center gap-1 text-green-600 text-xs">
                        <UserCheck className="w-4 h-4" /> Activo
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-1 text-gray-400 text-xs">
                        <UserX className="w-4 h-4" /> Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => setModal({ open: true, user })}
                        className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                        title="Editar"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(user)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500"
                        title="Eliminar"
                        disabled={String(user.id) === currentUserId}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {modal.open && (
        <UserModal
          user={modal.user}
          roles={roles}
          onClose={() => setModal({ open: false })}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['admin-users'] })}
        />
      )}
    </div>
  )
}
