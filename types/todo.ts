import type { Tag } from './tag'

export type TodoStatus = 'active' | 'pending' | 'blocked' | 'done' | 'cancelled'
export type TodoKind = 'action' | 'note' | 'rest'
export type TodoNoteType = 'user' | 'status_change'
export type TimeGrain = 'day' | 'week' | 'horizon'

export const TODO_STATUSES: TodoStatus[] = ['pending', 'active', 'blocked', 'done', 'cancelled']
export const TODO_STATUS_LABEL: Record<TodoStatus, string> = {
  pending: '待办',
  active: '进行中',
  blocked: '冻结',
  done: '完成',
  cancelled: '放弃',
}
export const TODO_KINDS: TodoKind[] = ['action', 'note', 'rest']
export const USER_TODO_KINDS: TodoKind[] = ['action', 'note']
export const TODO_KIND_LABEL: Record<TodoKind, string> = {
  action: '任务',
  note: '备注',
  rest: '休息',
}
export const NOTE_TYPES: TodoNoteType[] = ['user', 'status_change']
export const TIME_GRAINS: TimeGrain[] = ['day', 'week', 'horizon']

export function isTodoStatus(value: string): value is TodoStatus {
  return TODO_STATUSES.includes(value as TodoStatus)
}

export function isTodoKind(value: string): value is TodoKind {
  return TODO_KINDS.includes(value as TodoKind)
}

export function isTodoNoteType(value: string): value is TodoNoteType {
  return NOTE_TYPES.includes(value as TodoNoteType)
}

export function isTimeGrain(value: string): value is TimeGrain {
  return TIME_GRAINS.includes(value as TimeGrain)
}

export type TodoTimeLink = {
  id: string
  todoId: string
  grain: TimeGrain
  date: string
  createdAt?: string
}

export function todoTimeLinks(todo?: Pick<Todo, 'timeLinks'> | null): TodoTimeLink[] {
  return Array.isArray(todo?.timeLinks) ? todo.timeLinks : []
}

export function hasTimeLink(
  todo?: Pick<Todo, 'timeLinks'> | null,
  grain: TimeGrain = 'week',
  date?: string,
): boolean {
  return todoTimeLinks(todo).some((link) => link.grain === grain && (date == null || link.date === date))
}

export function dayTimeLinksOnOrBefore(
  todo?: Pick<Todo, 'timeLinks'> | null,
  untilDate?: string,
): TodoTimeLink[] {
  return todoTimeLinks(todo)
    .filter((link) => link.grain === 'day' && (untilDate == null || link.date <= untilDate))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
}

export function earliestDayLink(
  todo?: Pick<Todo, 'timeLinks'> | null,
  untilDate?: string,
): TodoTimeLink | null {
  return dayTimeLinksOnOrBefore(todo, untilDate)[0] ?? null
}

export function calendarDaysBetween(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00`)
  const to = Date.parse(`${toKey}T00:00:00`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.round((to - from) / 86_400_000)
}

export function isTodayScheduled(
  todo?: Pick<Todo, 'kind' | 'status' | 'completedAt' | 'updatedAt' | 'timeLinks'> | null,
  todayKey?: string,
): boolean {
  if (!todo || !todayKey) return false
  if (todo.kind === 'note' || todo.kind === 'rest' || todo.status === 'cancelled') return false
  if (!earliestDayLink(todo, todayKey)) return false
  if (isCarryTodoStatus(todo.status)) return true
  if (todo.status === 'done') {
    const completed = todo.completedAt ?? todo.updatedAt
    const completedKey = /^\d{4}-\d{2}-\d{2}$/.test(completed)
      ? completed
      : formatLocalDateKey(completed)
    return completedKey === todayKey
  }
  return false
}

export function todayDelayDays(
  todo?: Pick<Todo, 'status' | 'timeLinks'> | null,
  todayKey?: string,
): number {
  if (!todo || !todayKey || !isCarryTodoStatus(todo.status)) return 0
  const link = earliestDayLink(todo, todayKey)
  if (!link) return 0
  return Math.max(0, calendarDaysBetween(link.date, todayKey))
}

function formatLocalDateKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function weekStartOf(todo?: Pick<Todo, 'timeLinks'> | null): string | null {
  return todoTimeLinks(todo).find((link) => link.grain === 'week')?.date ?? null
}

export function dayIndexOf(todo?: Pick<Todo, 'timeLinks'> | null): number | null {
  const date = todoTimeLinks(todo).find((link) => link.grain === 'day')?.date
  if (!date) return null
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.getDay()
}

export function isScheduledTodo(todo?: Pick<Todo, 'timeLinks'> | null): boolean {
  return todoTimeLinks(todo).some((link) => link.grain === 'week' || link.grain === 'day')
}

export function isNoteKind(kind: TodoKind): boolean {
  return kind === 'note'
}

export function isRestKind(kind: TodoKind): boolean {
  return kind === 'rest'
}

export function isOpenTodoStatus(status: TodoStatus): boolean {
  return status !== 'done' && status !== 'cancelled'
}

export function isCarryTodoStatus(status: TodoStatus): boolean {
  return status === 'pending' || status === 'active' || status === 'blocked'
}

export function isStatusChangeNote(todo?: Pick<Todo, 'kind' | 'noteType'> | null): boolean {
  return todo?.kind === 'note' && todo.noteType === 'status_change'
}

export function isEditableNote(todo?: Pick<Todo, 'kind' | 'noteType'> | null): boolean {
  return todo?.kind === 'note' && todo.noteType !== 'status_change'
}

export type Todo = {
  id: string
  parentId: string | null
  sortOrder: number
  depth: number
  title: string
  description: string
  content: string
  status: TodoStatus
  estimatedMinutes: number
  kind: TodoKind
  timeLinks?: TodoTimeLink[]
  tags?: Tag[]
  noteType: TodoNoteType
  aaaTopicId: string | null
  version: number
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type TodoTimeSpan = {
  id: string
  todoId: string
  startedAt: string
  endedAt: string | null
  createdAt: string
}

export type CreateTodoInput = {
  title: string
  description?: string
  content?: string
  parentId?: string | null
  status?: TodoStatus
  estimatedMinutes?: number
  kind?: TodoKind
  time?: Array<{ grain: TimeGrain; date: string }>
  tagIds?: string[]
  sortOrder?: number
  noteType?: TodoNoteType
  aaaTopicId?: string | null
}

export type UpdateTodoInput = Partial<Omit<CreateTodoInput, 'parentId' | 'time'>> & {
  version?: number
}
