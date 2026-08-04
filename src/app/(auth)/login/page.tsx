import { Suspense } from 'react'
import type { Metadata } from 'next'
import { LoginForm } from './login-form'
import { CardSkeleton } from '@/components/ui/patterns'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    <Suspense fallback={<CardSkeleton lines={5} />}>
      <LoginForm />
    </Suspense>
  )
}
