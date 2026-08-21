import type { Metadata } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import Providers from '@/components/layout/Providers'
import AuthLayout from '@/components/layout/AuthLayout'

// Self-hosted via next/font — no external font request, zero layout shift.
// Applied once here per Next.js convention rather than per-page.
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
})

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
    <html lang="es" className={plusJakartaSans.variable}>
      <body className="antialiased bg-gray-50 text-gray-900 font-sans">
        <Providers>
          <AuthLayout>{children}</AuthLayout>
        </Providers>
      </body>
    </html>
  )
}
