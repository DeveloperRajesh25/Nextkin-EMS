import 'server-only'

/**
 * What the wizard page needs before it can render, loaded once.
 *
 * Shared by the "new" and the "resume" routes so both screens are assembled the
 * same way — a resumed draft must show exactly what a fresh one does, plus its
 * saved values.
 */
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { OrgContext } from '@/lib/auth/guards'
import type { Person } from './step-fields'

export interface WizardBootstrap {
  departments: { id: string; name: string }[]
  managers: Person[]
  currencySymbol: string
}

/**
 * The org has no currency setting yet (invoices carry their own), so pay is
 * labelled with a plain dollar sign. When a workspace currency lands in
 * settings, this is the single place that has to change.
 */
const DEFAULT_CURRENCY_SYMBOL = '$'

export async function loadWizardData(ctx: OrgContext): Promise<WizardBootstrap> {
  const supabase = await createSupabaseServerClient()

  const [{ data: departments }, { data: managers }] = await Promise.all([
    supabase.from('departments').select('id, name').order('name'),
    // Anyone already in the workspace can be a manager — RLS keeps this to the
    // caller's own tenant, so no extra filter is needed here.
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('is_active', true)
      .order('full_name'),
  ])

  return {
    departments: departments ?? [],
    managers: managers ?? [],
    currencySymbol: DEFAULT_CURRENCY_SYMBOL,
  }
}
