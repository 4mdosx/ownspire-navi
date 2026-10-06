import type {
  WeekPlanData,
  WeekPlanPendingActivity,
  WeekPlanTodo,
  CreateTodoTreeResult,
} from '@/types/week-plan'
import { toWeekPlanTodo } from '@/types/week-plan'
import type { Todo, TodoKind } from '@/types/todo'
import { dateFromWeekDay, formatWeekStart } from '@/backstage/week-plan/week-utils'

export const formatWeekStartClient = formatWeekStart

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json()
  if (!res.ok) {
    const err = new Error(
      typeof data?.error === 'string' ? data.error : 'Request failed'
    ) as Error & { logId?: string }
    if (typeof data.logId === 'string') {
      err.logId = data.logId
    }
    throw err
  }
  return data as T
}

export async function fetchWeekPlan(weekStart: string): Promise<WeekPlanData> {
  const res = await fetch(
    `/api/week-plan?weekStart=${encodeURIComponent(weekStart)}`,
    { credentials: 'include' }
  )
  return parseJson<WeekPlanData>(res)
}

export async function apiCreateTodo(input: {
  title: string
  dayIndex: number
  weekStart: string
  estimatedHours?: number
}): Promise<WeekPlanTodo> {
  const res = await fetch('/api/week-plan/todos', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await parseJson<{ todo: WeekPlanTodo }>(res)
  return data.todo
}

export async function apiAddTodoFromPending(input: {
  id: string
  title: string
  day: number
  dayIndex: number
  weekStart: string
}): Promise<{ todo: WeekPlanTodo; pending: WeekPlanPendingActivity[] }> {
  const res = await fetch('/api/week-plan/todos', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'fromPending', ...input }),
  })
  return parseJson(res)
}

export async function apiStartTodo(
  id: string,
  weekStart: string
): Promise<WeekPlanTodo> {
  const res = await fetch('/api/week-plan/todos', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action: 'start', weekStart }),
  })
  const data = await parseJson<{ todo: WeekPlanTodo }>(res)
  return data.todo
}

export async function apiCompleteTodo(id: string): Promise<WeekPlanTodo> {
  const res = await fetch('/api/week-plan/todos', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action: 'complete' }),
  })
  const data = await parseJson<{ todo: WeekPlanTodo }>(res)
  return data.todo
}

export async function apiMoveTodoToPending(id: string): Promise<{
  pending: WeekPlanPendingActivity[]
  todos: WeekPlanTodo[]
}> {
  const res = await fetch('/api/week-plan/todos', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action: 'moveToPending' }),
  })
  return parseJson(res)
}

export async function apiDeleteTodo(id: string): Promise<void> {
  const res = await fetch('/api/week-plan/todos', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  await parseJson(res)
}

export async function apiCreatePending(input: {
  title: string
  estimatedHours?: number
  aaaTopicId?: string | null
}): Promise<WeekPlanPendingActivity> {
  const res = await fetch('/api/week-plan/pending', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await parseJson<{ pending: WeekPlanPendingActivity }>(res)
  return data.pending
}

export async function apiUpdatePending(
  id: string,
  input: { title?: string; estimatedHours?: number }
): Promise<WeekPlanPendingActivity> {
  const res = await fetch('/api/week-plan/pending', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...input }),
  })
  const data = await parseJson<{ pending: WeekPlanPendingActivity }>(res)
  return data.pending
}

export async function apiDeletePending(id: string): Promise<void> {
  const res = await fetch('/api/week-plan/pending', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  await parseJson(res)
}

export async function apiCreateTodoTree(input: {
  dayIndex: number
  weekStart: string
  parent?: { title: string; aaaTopicId?: string | null }
  subtasks?: Array<{ title: string; estimatedHours: number }>
  root?: { title: string; estimatedHours: number; aaaTopicId?: string | null }
}): Promise<CreateTodoTreeResult> {
  const res = await fetch('/api/week-plan/todos', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createTree', ...input }),
  })
  return parseJson(res)
}

export async function apiUpdateTodo(
  id: string,
  input: {
    title?: string
    description?: string
    content?: string
    status?: WeekPlanTodo['status']
    kind?: TodoKind
    aaaTopicId?: string | null
    version: number
  }
): Promise<WeekPlanTodo> {
  const res = await fetch(`/api/todos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await parseJson<{ data: Todo }>(res)
  return toWeekPlanTodo(data.data)
}

export async function apiCreateSubtask(input: {
  parentId: string
  title: string
  description?: string
  weekStart: string
  dayIndex: number
  estimatedMinutes: number
}): Promise<WeekPlanTodo> {
  const res = await fetch('/api/todos', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentId: input.parentId,
      title: input.title,
      description: input.description,
      estimatedMinutes: input.estimatedMinutes,
      time: [
        { grain: 'week', date: input.weekStart },
        { grain: 'day', date: dateFromWeekDay(input.weekStart, input.dayIndex) },
      ],
    }),
  })
  const data = await parseJson<{ data: Todo }>(res)
  return toWeekPlanTodo(data.data)
}
