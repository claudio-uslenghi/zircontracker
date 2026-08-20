'use client'

import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8 text-center">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
          style={{ backgroundColor: '#fee2e2' }}
        >
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">Acceso denegado</h1>
        <p className="text-gray-500 text-sm mb-6">
          No tenés permiso para acceder a esta sección. Contactá al administrador si creés que es un error.
        </p>
        <Link
          href="/dashboard"
          className="inline-block py-2 px-6 rounded-lg text-white text-sm font-medium"
          style={{ backgroundColor: '#0170B9' }}
        >
          Ir al inicio
        </Link>
      </div>
    </div>
  )
}
