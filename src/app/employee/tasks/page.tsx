import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadBoard } from '@/lib/board-data'
import { PageHeader } from '@/components/ui/patterns'
import { KanbanBoard } from '@/components/board/kanban-board'
import { EmptyState } from '@/components/ui/patterns'
import { Card } from '@/components/ui/card'
import { KanbanSquare } from 'lucide-react'

export const metadata: Metadata = { title: 'My tasks' }
export const dynamic = 'force-dynamic'

export default async function EmployeeTasksPage() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()
  const board = await loadBoard(supabase)

  const assignedCount = board.tasks.filter((t) =>
    t.assignees.some((a) => a.id === ctx.userId)
  ).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Task board"
        description={
          assignedCount
            ? `You can move the ${assignedCount} ${
                assignedCount === 1 ? 'card' : 'cards'
              } assigned to you. Everything else is read-only.`
            : 'You can move cards once they are assigned to you.'
        }
      />

      {board.boardId ? (
        <KanbanBoard
          boardId={board.boardId}
          columns={board.columns}
          initialTasks={board.tasks}
          tenantId={ctx.tenantId}
          // Employees never create or delete; the same rule is enforced by the
          // `tasks_insert`/`tasks_delete` policies, which grant those to org
          // users only. This just stops the UI offering what would be refused.
          canManage={false}
          currentUserId={ctx.userId}
        />
      ) : (
        <Card>
          <EmptyState
            icon={KanbanSquare}
            title="No board yet"
            description="Your organization has not set up a task board."
          />
        </Card>
      )}
    </div>
  )
}
