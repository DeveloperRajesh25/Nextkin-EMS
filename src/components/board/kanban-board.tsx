'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCorners, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, GripVertical, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { StatusChip, EmptyState } from '@/components/ui/patterns'
import { apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { createClient } from '@/lib/supabase/client'
import { cn, initials } from '@/lib/utils'
import type { TaskPriority } from '@/types/db'

export interface BoardTask {
  id: string
  column_id: string
  title: string
  description: string | null
  position: number
  priority: TaskPriority
  due_date: string | null
  assignees: Array<{ id: string; full_name: string | null; email: string | null; photo_url: string | null }>
}

export interface BoardColumnData {
  id: string
  name: string
  position: number
}

/** Midpoint between neighbours, so a drop rewrites ONE row. */
function positionBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1000
  if (before === undefined) return after! - 1000
  if (after === undefined) return before + 1000
  return (before + after) / 2
}

export function KanbanBoard({
  boardId, columns, initialTasks, tenantId, canManage, currentUserId, onAddTask,
}: {
  boardId: string
  columns: BoardColumnData[]
  initialTasks: BoardTask[]
  tenantId: string
  canManage: boolean
  currentUserId: string
  onAddTask?: (columnId: string) => void
}) {
  const router = useRouter()
  const [tasks, setTasks] = React.useState(initialTasks)
  const [dragging, setDragging] = React.useState<BoardTask | null>(null)

  // Keep in step when the server component re-renders with fresh data.
  React.useEffect(() => setTasks(initialTasks), [initialTasks])

  /*
   * Realtime.
   *
   * The subscription runs on the user's OWN auth session, so Supabase applies
   * the `tasks_select` policy to each subscriber — a tenant physically cannot
   * receive another tenant's change events, no custom token required. The filter
   * below is a bandwidth optimisation, not the isolation boundary.
   *
   * A change refreshes from the server rather than patching local state from the
   * payload: the payload has no assignee join, and a refresh is simpler to
   * reason about than reconciling two sources of truth.
   */
  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `tenant_id=eq.${tenantId}` },
        () => router.refresh()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [boardId, tenantId, router])

  const sensors = useSensors(
    // A small activation distance so a click on a card is a click, not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  const byColumn = React.useMemo(() => {
    const map = new Map<string, BoardTask[]>()
    for (const column of columns) map.set(column.id, [])
    for (const task of tasks) {
      if (!map.has(task.column_id)) map.set(task.column_id, [])
      map.get(task.column_id)!.push(task)
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [tasks, columns])

  function canMove(task: BoardTask): boolean {
    // Mirrors the `tasks_update` policy. The database is the enforcement point;
    // this just avoids offering a drag that would be refused.
    return canManage || task.assignees.some((a) => a.id === currentUserId)
  }

  function onDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id)
    if (task && canMove(task)) setDragging(task)
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const task = tasks.find((t) => t.id === active.id)
    if (!task || !canMove(task)) return

    // The drop target is either a column (empty area) or another card.
    const overTask = tasks.find((t) => t.id === over.id)
    const targetColumn = overTask ? overTask.column_id : String(over.id)
    if (!columns.some((c) => c.id === targetColumn)) return

    const siblings = (byColumn.get(targetColumn) ?? []).filter((t) => t.id !== task.id)
    let position: number

    if (overTask) {
      const index = siblings.findIndex((t) => t.id === overTask.id)
      position = positionBetween(siblings[index - 1]?.position, siblings[index]?.position)
    } else {
      position = positionBetween(siblings[siblings.length - 1]?.position, undefined)
    }

    if (task.column_id === targetColumn && task.position === position) return

    // Optimistic: the card lands where it was dropped immediately.
    const previous = tasks
    setTasks((current) =>
      current.map((t) => (t.id === task.id ? { ...t, column_id: targetColumn, position } : t))
    )

    try {
      await apiPatch(`/api/tasks/${task.id}`, { columnId: targetColumn, position })
    } catch (err) {
      // Roll the board back to exactly what the server last confirmed. Leaving
      // the optimistic position would show a move that did not happen.
      setTasks(previous)
      toast.error(err instanceof ApiClientError ? err.message : 'That task could not be moved')
    }
  }

  async function deleteTask(taskId: string) {
    const previous = tasks
    setTasks((current) => current.filter((t) => t.id !== taskId))
    try {
      await apiDelete(`/api/tasks/${taskId}`)
      toast.success('Task deleted')
    } catch (err) {
      setTasks(previous)
      toast.error(err instanceof ApiClientError ? err.message : 'That task could not be deleted')
    }
  }

  if (!columns.length) {
    return (
      <EmptyState
        icon={Plus}
        title="This board has no columns"
        description="Add a column to start organising work."
      />
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="scrollbar-thin flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => {
          const columnTasks = byColumn.get(column.id) ?? []
          return (
            <Column
              key={column.id}
              column={column}
              tasks={columnTasks}
              canManage={canManage}
              canMove={canMove}
              onDelete={deleteTask}
              onAdd={onAddTask}
            />
          )
        })}
      </div>

      <DragOverlay>
        {dragging ? <TaskCard task={dragging} overlay canManage={canManage} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({
  column, tasks, canManage, canMove, onDelete, onAdd,
}: {
  column: BoardColumnData
  tasks: BoardTask[]
  canManage: boolean
  canMove: (task: BoardTask) => boolean
  onDelete: (id: string) => void
  onAdd?: (columnId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <section
      className={cn(
        'flex w-[290px] shrink-0 flex-col rounded-xl border border-line bg-page/70 transition',
        isOver && 'border-brand-200 bg-brand-50/50'
      )}
    >
      <header className="flex items-center gap-2 px-4 py-3">
        <h3 className="flex-1 truncate text-[13px] font-semibold uppercase tracking-wider text-ink-muted">
          {column.name}
        </h3>
        <span className="tabular rounded-full bg-card px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-line">
          {tasks.length}
        </span>
        {canManage && onAdd ? (
          <button
            type="button"
            onClick={() => onAdd(column.id)}
            aria-label={`Add a task to ${column.name}`}
            className="focus-ring rounded-md p-1 text-ink-muted transition hover:bg-card hover:text-brand-600"
          >
            <Plus className="size-4" />
          </button>
        ) : null}
      </header>

      <div ref={setNodeRef} className="flex min-h-[120px] flex-1 flex-col gap-2 px-3 pb-3">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTask
              key={task.id}
              task={task}
              draggable={canMove(task)}
              canManage={canManage}
              onDelete={onDelete}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-ink-muted">Nothing here yet</p>
        ) : null}
      </div>
    </section>
  )
}

function SortableTask({
  task, draggable, canManage, onDelete,
}: {
  task: BoardTask
  draggable: boolean
  canManage: boolean
  onDelete: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !draggable,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
    >
      <TaskCard
        task={task}
        canManage={canManage}
        onDelete={onDelete}
        dragHandle={
          draggable ? (
            <button
              type="button"
              aria-label={`Move ${task.title}`}
              className="focus-ring -ml-1 cursor-grab touch-none rounded p-0.5 text-ink-muted/60 hover:text-ink-muted active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </button>
          ) : null
        }
      />
    </div>
  )
}

function TaskCard({
  task, overlay, canManage, onDelete, dragHandle,
}: {
  task: BoardTask
  overlay?: boolean
  canManage: boolean
  onDelete?: (id: string) => void
  dragHandle?: React.ReactNode
}) {
  const overdue =
    task.due_date && new Date(task.due_date) < new Date(new Date().toDateString())

  return (
    <article
      className={cn(
        'card-surface group p-3',
        overlay && 'rotate-2 shadow-pop'
      )}
    >
      <div className="flex items-start gap-1.5">
        {dragHandle}
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{task.title}</p>
        {canManage && onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(task.id)}
            aria-label={`Delete ${task.title}`}
            className="focus-ring rounded p-0.5 text-ink-muted/0 transition group-hover:text-ink-muted hover:!text-danger"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>

      {task.description ? (
        <p className="mt-1.5 line-clamp-2 pl-[22px] text-xs leading-relaxed text-ink-muted">
          {task.description}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[22px]">
        <StatusChip status={task.priority} />
        {task.due_date ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              overdue ? 'font-medium text-danger' : 'text-ink-muted'
            )}
          >
            <CalendarDays className="size-3.5" aria-hidden />
            {task.due_date}
          </span>
        ) : null}

        {task.assignees.length ? (
          <div className="ml-auto flex -space-x-1.5">
            {task.assignees.slice(0, 3).map((person) => (
              <Avatar key={person.id} className="size-6 ring-2 ring-card">
                {person.photo_url ? (
                  <AvatarImage
                    src={`/api/files/view?key=${encodeURIComponent(person.photo_url)}`}
                    alt={person.full_name ?? ''}
                  />
                ) : null}
                <AvatarFallback className="text-[9px]">
                  {initials(person.full_name, person.email)}
                </AvatarFallback>
              </Avatar>
            ))}
            {task.assignees.length > 3 ? (
              <span className="grid size-6 place-items-center rounded-full bg-page text-[9px] font-semibold text-ink-muted ring-2 ring-card">
                +{task.assignees.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}
