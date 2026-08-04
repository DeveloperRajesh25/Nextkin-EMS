import 'server-only'

/**
 * Board loading, shared by the org board page and the employee "my tasks" view.
 *
 * Every query runs on the caller's RLS-scoped client, so the same code returns
 * the whole board to an org and only the caller's tenant to an employee, with no
 * role branching here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BoardTask, BoardColumnData } from '@/components/board/kanban-board'

export interface BoardData {
  boardId: string | null
  boardName: string
  columns: BoardColumnData[]
  tasks: BoardTask[]
  members: Array<{ id: string; full_name: string | null; email: string | null; photo_url: string | null }>
}

export async function loadBoard(supabase: SupabaseClient): Promise<BoardData> {
  const empty: BoardData = {
    boardId: null,
    boardName: 'Team Board',
    columns: [],
    tasks: [],
    members: [],
  }

  const { data: board } = await supabase
    .from('boards')
    .select('id, name')
    .order('created_at')
    .limit(1)
    .maybeSingle()

  if (!board) return empty

  const [{ data: columns }, { data: tasks }, { data: members }] = await Promise.all([
    supabase
      .from('board_columns')
      .select('id, name, position')
      .eq('board_id', board.id)
      .order('position'),
    supabase
      .from('tasks')
      .select('id, column_id, title, description, position, priority, due_date')
      .eq('board_id', board.id)
      .order('position'),
    supabase
      .from('profiles')
      .select('id, full_name, email, photo_url')
      .eq('is_active', true)
      .order('full_name'),
  ])

  // Assignees in one round trip rather than one per card.
  const taskIds = (tasks ?? []).map((t) => t.id)
  const assigneesByTask = new Map<string, BoardTask['assignees']>()

  if (taskIds.length) {
    const { data: links } = await supabase
      .from('task_assignees')
      .select('task_id, profile_id')
      .in('task_id', taskIds)

    const memberById = new Map((members ?? []).map((m) => [m.id, m]))
    for (const link of links ?? []) {
      const person = memberById.get(link.profile_id)
      if (!person) continue
      const list = assigneesByTask.get(link.task_id) ?? []
      list.push(person)
      assigneesByTask.set(link.task_id, list)
    }
  }

  return {
    boardId: board.id,
    boardName: board.name,
    columns: (columns ?? []) as BoardColumnData[],
    tasks: (tasks ?? []).map((task) => ({
      ...task,
      position: Number(task.position),
      assignees: assigneesByTask.get(task.id) ?? [],
    })) as BoardTask[],
    members: members ?? [],
  }
}
