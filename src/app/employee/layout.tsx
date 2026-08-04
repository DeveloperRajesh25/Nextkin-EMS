import { requireEmployee } from '@/lib/auth/guards'
import { AppShell } from '@/components/shell/app-shell'

export const dynamic = 'force-dynamic'

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireEmployee()
  return <AppShell ctx={ctx}>{children}</AppShell>
}
