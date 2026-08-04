import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import '@/app/globals.css'

// Importing this for its side effect: environment validation runs once per
// server instance, at boot, before any request is served.
import '@/lib/env'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: {
    default: 'NextKinLife EMS',
    template: '%s · NextKinLife EMS',
  },
  description: 'Employee management for modern care organizations.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#16181F',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            className: 'rounded-xl border border-line shadow-card',
            style: { background: '#FFFFFF', color: '#1A1C23' },
          }}
        />
      </body>
    </html>
  )
}
