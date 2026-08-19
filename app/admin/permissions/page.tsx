'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'

interface PageDef {
  path: string
  label: string
}

interface RoleDef {
  id: number
  name: string
}

interface PermissionsData {
  pages: PageDef[]
  roles: RoleDef[]
  matrix: Record<string, Record<number, boolean>>
}

const HEADER_STYLE = { backgroundColor: '#0170B9' }

export default function PermissionsPage() {
  const queryClient = useQueryClient()
  const [localMatrix, setLocalMatrix] = useState<Record<string, Record<number, boolean>> | null>(
    null
  )
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const { data, isLoading } = useQuery<PermissionsData>({
    queryKey: ['admin-permissions'],
    queryFn: async () => {
      const d: PermissionsData = await fetch('/api/admin/permissions').then((r) => r.json())
      // Deep copy matrix for local editing
      const copy: Record<string, Record<number, boolean>> = {}
      for (const [page, roleMap] of Object.entries(d.matrix)) {
        copy[page] = { ...roleMap }
      }
      setLocalMatrix(copy)
      return d
    },
  })

  const matrix = localMatrix ?? data?.matrix ?? {}

  function toggle(page: string, roleId: number) {
    setLocalMatrix((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        [page]: {
          ...prev[page],
          [roleId]: !prev[page]?.[roleId],
        },
      }
    })
  }

  async function savePage(page: string) {
    if (!data) return
    setSaving(page)
    const roleIds = data.roles
      .filter((r) => matrix[page]?.[r.id])
      .map((r) => r.id)

    try {
      const res = await fetch('/api/admin/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, roleIds }),
      })
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['admin-permissions'] })
        setSaved(page)
        setTimeout(() => setSaved(null), 2000)
      }
    } finally {
      setSaving(null)
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 text-gray-500 text-sm">Cargando permisos...</div>
    )
  }

  const pages = data?.pages ?? []
  const roles = data?.roles ?? []

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold" style={{ color: '#3a3a3a' }}>
          Permisos de páginas
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Asigná qué roles pueden acceder a cada página. Los cambios se guardan por fila.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={HEADER_STYLE}>
              <th className="px-4 py-3 text-left text-white font-medium">Página</th>
              {roles.map((r) => (
                <th key={r.id} className="px-4 py-3 text-center text-white font-medium capitalize">
                  {r.name}
                </th>
              ))}
              <th className="px-4 py-3 text-center text-white font-medium">Guardar</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page, i) => (
              <tr key={page.path} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-800">{page.label}</span>
                  <span className="ml-2 text-xs text-gray-400">{page.path}</span>
                </td>
                {roles.map((role) => {
                  // admin always has all pages — show as checked and disabled
                  const isAdmin = role.name === 'admin'
                  const checked = isAdmin ? true : (matrix[page.path]?.[role.id] ?? false)
                  return (
                    <td key={role.id} className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isAdmin}
                        onChange={() => !isAdmin && toggle(page.path, role.id)}
                        className="w-4 h-4 rounded accent-blue-600 cursor-pointer disabled:cursor-default"
                      />
                    </td>
                  )
                })}
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => savePage(page.path)}
                    disabled={saving === page.path}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-xs font-medium disabled:opacity-60"
                    style={{
                      backgroundColor: saved === page.path ? '#16a34a' : '#0170B9',
                    }}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saved === page.path ? 'Guardado' : saving === page.path ? '...' : 'Guardar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
