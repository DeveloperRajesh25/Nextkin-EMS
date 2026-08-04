'use client'

/**
 * CLIENT #1 of 3 — the browser client.
 *
 * Anon key + cookie adapter. Every query it makes is RLS-scoped to the signed-in
 * user, so it is safe to use directly from client components for reads and for
 * Realtime subscriptions. It can never see another tenant's rows because the
 * policies in 002_rls.sql are evaluated by Postgres, not by this code.
 *
 * Mutations still go through Server Actions / Route Handlers so they are Zod
 * validated and audited in one place.
 */
import { createBrowserClient } from '@supabase/ssr'

let cached: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (cached) return cached
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  return cached
}
