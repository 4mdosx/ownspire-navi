import 'server-only'
import {
  createTodo, deleteTodo, getTodo, linkTodoTime, listTodos, unlinkTodoTime, updateTodo,
} from '@/backstage/todo/todo.service'
import { selectWeekOutline } from '@/lib/todo-outline'
import { dateFromWeekDay } from './week-utils'
import { normalizeEstimatedHours } from './week-plan-hours'
import type {
  CreateTodoTreeInput, CreateTodoTreeResult, TodoStatus,
  WeekPlanData, WeekPlanPendingActivity, WeekPlanTodo,
} from '@/types/week-plan'
import { toWeekPlanTodo } from '@/types/week-plan'
import type { Todo } from '@/types/todo'

function toPending(todo: Todo): WeekPlanPendingActivity {
  return { id: todo.id, title: todo.title, day: todo.estimatedMinutes / 60, aaaTopicId: todo.aaaTopicId }
}

export async function getWeekPlanData(weekStart: string): Promise<WeekPlanData> {
  const todos = await listTodos()
  const weekTodos = selectWeekOutline(todos, weekStart)
  const pending = todos.filter((todo) => (todo.timeLinks ?? []).length === 0 && !todo.parentId)
  return { weekStart, pending: pending.map(toPending), todos: weekTodos.map(toWeekPlanTodo) }
}

export async function createWeekPlanTodo(input: {
  title: string; description?: string; content?: string; dayIndex: number; weekStart: string
  estimatedHours?: number; status?: TodoStatus; startedAtMs?: number
  aaaTopicId?: string | null
}): Promise<WeekPlanTodo> {
  const todo = await createTodo({
    title: input.title,
    description: input.description,
    content: input.content,
    estimatedMinutes: normalizeEstimatedHours(input.estimatedHours ?? 1) * 60,
    status: input.status,
    aaaTopicId: input.aaaTopicId,
    time: [
      { grain: 'week', date: input.weekStart },
      { grain: 'day', date: dateFromWeekDay(input.weekStart, input.dayIndex) },
    ],
  })
  return toWeekPlanTodo(todo)
}

export async function createWeekPlanTodoTree(input: CreateTodoTreeInput): Promise<CreateTodoTreeResult> {
  const subtasks = input.subtasks ?? []
  if (subtasks.length === 0) {
    const root = input.root ?? (input.parent ? { title: input.parent.title, estimatedHours: 1 } : null)
    if (!root) throw new Error('root title is required')
    return { root: await createWeekPlanTodo({ ...root, dayIndex: input.dayIndex, weekStart: input.weekStart }) }
  }
  if (!input.parent?.title.trim()) throw new Error('parent title is required when subtasks are provided')
  const time = [
    { grain: 'week' as const, date: input.weekStart },
    { grain: 'day' as const, date: dateFromWeekDay(input.weekStart, input.dayIndex) },
  ]
  const parent = await createTodo({
    title: input.parent.title,
    aaaTopicId: input.parent.aaaTopicId,
    estimatedMinutes: subtasks.reduce((sum, item) => sum + normalizeEstimatedHours(item.estimatedHours) * 60, 0),
    time,
  })
  const children: Todo[] = []
  try {
    for (let index = 0; index < subtasks.length; index++) {
      const item = subtasks[index]
      children.push(await createTodo({
        title: item.title, parentId: parent.id, sortOrder: index,
        aaaTopicId: input.parent.aaaTopicId,
        estimatedMinutes: normalizeEstimatedHours(item.estimatedHours) * 60,
        time,
      }))
    }
  } catch (error) {
    await deleteTodo(parent.id, true)
    throw error
  }
  return { parent: toWeekPlanTodo(parent), subtasks: children.map(toWeekPlanTodo) }
}

export async function addTodoFromPendingActivity(input: {
  id: string; title: string; day: number; dayIndex: number; weekStart: string
}): Promise<{ todo: WeekPlanTodo; pending: WeekPlanPendingActivity[] }> {
  const todo = await updateTodo(input.id, {
    title: input.title, status: 'active',
    estimatedMinutes: normalizeEstimatedHours(input.day) * 60,
  })
  await linkTodoTime(input.id, 'week', input.weekStart)
  await linkTodoTime(input.id, 'day', dateFromWeekDay(input.weekStart, input.dayIndex))
  const pending = (await listTodos()).filter((item) => (item.timeLinks ?? []).length === 0 && !item.parentId)
  return { todo: toWeekPlanTodo(todo), pending: pending.map(toPending) }
}

export async function moveTodoToPending(id: string): Promise<{
  pending: WeekPlanPendingActivity[]; todos: WeekPlanTodo[]
}> {
  const current = await getTodo(id)
  const weekStart = current.timeLinks?.find((link) => link.grain === 'week')?.date
  await unlinkTodoTime(id, 'week')
  await unlinkTodoTime(id, 'day')
  await updateTodo(id, { status: 'pending' })
  const todos = await listTodos()
  const pending = todos.filter((item) => (item.timeLinks ?? []).length === 0 && !item.parentId)
  const weekTodos = weekStart
    ? todos.filter((item) => (item.timeLinks ?? []).some((link) => link.grain === 'week' && link.date === weekStart))
    : []
  return { pending: pending.map(toPending), todos: weekTodos.map(toWeekPlanTodo) }
}

export async function startWeekPlanTodo(id: string, weekStart: string): Promise<WeekPlanTodo> {
  const children = await listTodos({ parentId: id })
  if (children.length) throw new Error('Cannot start a parent todo with subtasks; start a subtask instead')
  const active = (await listTodos({ grain: 'week', date: weekStart })).filter((todo) => todo.status === 'active')
  await Promise.all(active.filter((todo) => todo.id !== id).map((todo) => updateTodo(todo.id, { status: 'pending' })))
  return toWeekPlanTodo(await updateTodo(id, { status: 'active' }))
}

export async function completeWeekPlanTodo(id: string): Promise<WeekPlanTodo> {
  return toWeekPlanTodo(await updateTodo(id, { status: 'done' }))
}

export async function deleteWeekPlanTodo(id: string): Promise<void> {
  await deleteTodo(id, true)
}

export async function createPendingActivity(input: {
  title: string; estimatedHours?: number; aaaTopicId?: string | null
}): Promise<WeekPlanPendingActivity> {
  return toPending(await createTodo({
    title: input.title,
    estimatedMinutes: normalizeEstimatedHours(input.estimatedHours ?? 1) * 60,
    aaaTopicId: input.aaaTopicId,
  }))
}

export async function updatePendingActivity(id: string, input: {
  title?: string; estimatedHours?: number
}): Promise<WeekPlanPendingActivity> {
  return toPending(await updateTodo(id, {
    title: input.title,
    estimatedMinutes: input.estimatedHours == null ? undefined : normalizeEstimatedHours(input.estimatedHours) * 60,
  }))
}

export async function deletePendingActivity(id: string): Promise<void> {
  await deleteTodo(id)
}
