import type { Metadata } from 'next'
import './globals.css'
import Providers from '@/components/layout/Providers'
import AuthLayout from '@/components/layout/AuthLayout'

export const metadata: Metadata = {
  title: 'ZirconTracker',
  description: 'Carga de horas, vacaciones, proyectos y control de horas — ZirconTech',
  icons: {
    icon: '/icon.jpg',
    apple: '/icon.jpg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased bg-gray-50 text-gray-900">
        <Providers>
          <AuthLayout>{children}</AuthLayout>
        </Providers>
      </body>
    </html>
  )
}
