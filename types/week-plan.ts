import type { TodoStatus } from './todo'
import type { Todo } from './todo'
import { dayIndexOf, weekStartOf } from './todo'
export type { TodoStatus } from './todo'

export type WeekPlanPendingActivity = {
  id: string
  title: string
  /** 预计时长（小时） */
  day: number
  aaaTopicId: string | null
}

export type WeekPlanTodo = {
  id: string
  parentId: string | null
  sortOrder: number
  title: string
  description: string
  content: string
  version: number
  status: TodoStatus
  estimatedHours: number
  /** 由 day time link 推导，0 = 周日 … 6 = 周六 */
  dayIndex: number
  /** 由 week time link 推导 */
  weekStart: string
  startedAtMs?: number
  completedAtMs?: number
  createdAt: string
  updatedAt: string
  aaaTopicId: string | null
}

export function toWeekPlanTodo(todo: Todo): WeekPlanTodo {
  return {
    id: todo.id,
    parentId: todo.parentId,
    sortOrder: todo.sortOrder,
    title: todo.title,
    description: todo.description,
    content: todo.content,
    version: todo.version,
    status: todo.status,
    estimatedHours: todo.estimatedMinutes / 60,
    dayIndex: dayIndexOf(todo) ?? 0,
    weekStart: weekStartOf(todo) ?? '',
    startedAtMs: todo.startedAt ? Date.parse(todo.startedAt) : undefined,
    completedAtMs: todo.completedAt ? Date.parse(todo.completedAt) : undefined,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    aaaTopicId: todo.aaaTopicId,
  }
}

export type CreateTodoTreeInput = {
  dayIndex: number
  weekStart: string
  parent?: { title: string; aaaTopicId?: string | null }
  subtasks?: Array<{ title: string; estimatedHours: number }>
  root?: { title: string; estimatedHours: number; aaaTopicId?: string | null }
}

export type CreateTodoTreeResult = {
  parent?: WeekPlanTodo
  subtasks?: WeekPlanTodo[]
  root?: WeekPlanTodo
}

export type WeekPlanData = {
  weekStart: string
  pending: WeekPlanPendingActivity[]
  todos: WeekPlanTodo[]
}
