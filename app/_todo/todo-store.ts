import { create } from 'zustand'
import type { WeekPlanPendingActivity, WeekPlanTodo } from '@/types/week-plan'
import type { TodoKind } from '@/types/todo'
import { normalizeEstimatedHours } from '@/backstage/week-plan/week-plan-hours'
import {
  apiAddTodoFromPending,
  apiCompleteTodo,
  apiCreatePending,
  apiCreateTodo,
  apiCreateTodoTree,
  apiDeletePending,
  apiDeleteTodo,
  apiMoveTodoToPending,
  apiStartTodo,
  apiCreateSubtask,
  apiUpdateTodo,
  apiUpdatePending,
  fetchWeekPlan,
} from './week-plan-api'

export type PendingActivity = {
  id: string
  title: string
  /** 预计时长（小时） */
  day: number
  aaaTopicId: string | null
}

export type ActivityDragPayload = {
  kind: 'week-activity'
  source: 'pending' | 'todo'
  id: string
  title: string
  day: number
}

export type TodoStatus = WeekPlanTodo['status']

export type TodoItem = {
  id: string
  parentId: string | null
  sortOrder: number
  title: string
  description: string
  content: string
  version: number
  status: TodoStatus
  estimatedHours: number
  /** 0 = 周日 … 6 = 周六，由 day time link 推导 */
  dayIndex: number
  startedAtMs?: number
  completedAtMs?: number
  aaaTopicId: string | null
  subtasks?: TodoItem[]
}

function mapTodo(t: WeekPlanTodo): TodoItem {
  return {
    id: t.id,
    parentId: t.parentId,
    sortOrder: t.sortOrder,
    title: t.title,
    description: t.description,
    content: t.content,
    version: t.version,
    status: t.status,
    estimatedHours: t.estimatedHours,
    dayIndex: t.dayIndex,
    startedAtMs: t.startedAtMs,
    completedAtMs: t.completedAtMs,
    aaaTopicId: t.aaaTopicId,
  }
}

function mapPending(p: WeekPlanPendingActivity): PendingActivity {
  return {
    id: p.id,
    title: p.title,
    day: p.day,
    aaaTopicId: p.aaaTopicId,
  }
}

export function buildTodoTree(flat: TodoItem[]): TodoItem[] {
  const nodes = new Map(flat.map((t) => [t.id, { ...t, subtasks: [] as TodoItem[] }]))
  const roots: TodoItem[] = []

  for (const t of flat) {
    const node = nodes.get(t.id)!
    if (t.parentId && nodes.has(t.parentId)) {
      nodes.get(t.parentId)!.subtasks!.push(node)
    } else if (!t.parentId) {
      roots.push(node)
    }
  }

  for (const root of roots) {
    root.subtasks?.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  return roots
}

type TodoStore = {
  weekStart: string | null
  isLoading: boolean
  error: string | null
  draggingPayload: ActivityDragPayload | null
  pending: PendingActivity[]
  todos: TodoItem[]
  setDraggingPayload: (payload: ActivityDragPayload | null) => void
  loadWeek: (weekStart: string) => Promise<void>
  addTodoFromDrop: (
    activity: Omit<ActivityDragPayload, 'kind' | 'source'>,
    dayIndex: number
  ) => Promise<void>
  addTodo: (input: {
    title: string
    dayIndex: number
    estimatedHours?: number
  }) => Promise<void>
  addTodoTree: (input: {
    dayIndex: number
    parent?: { title: string; aaaTopicId?: string | null }
    subtasks?: Array<{ title: string; estimatedHours: number }>
    root?: { title: string; estimatedHours: number; aaaTopicId?: string | null }
  }) => Promise<void>
  addPending: (input: {
    title: string
    estimatedHours?: number
    aaaTopicId?: string | null
  }) => Promise<void>
  updatePending: (
    id: string,
    input: { title?: string; estimatedHours?: number }
  ) => Promise<void>
  removePending: (id: string) => Promise<void>
  moveTodoBackToPending: (id: string) => Promise<void>
  startTodo: (id: string) => Promise<void>
  completeTodo: (id: string) => Promise<void>
  updateTodo: (id: string, input: {
    title?: string
    description?: string
    content?: string
    status?: TodoStatus
    kind?: TodoKind
    aaaTopicId?: string | null
    version: number
  }) => Promise<void>
  addSubtask: (parentId: string, input: { title: string; description?: string }) => Promise<void>
  removeTodo: (id: string) => Promise<void>
}

export const useTodoStore = create<TodoStore>((set, get) => ({
  weekStart: null,
  isLoading: false,
  error: null,
  draggingPayload: null,
  pending: [],
  todos: [],
  setDraggingPayload: (payload) => set({ draggingPayload: payload }),
  loadWeek: async (weekStart) => {
    set({ isLoading: true, error: null, weekStart })
    try {
      const data = await fetchWeekPlan(weekStart)
      set({
        pending: data.pending.map(mapPending),
        todos: data.todos.map(mapTodo),
        weekStart: data.weekStart,
        isLoading: false,
        error: null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载失败'
      console.error('Failed to load week plan:', error)
      set({ isLoading: false, error: message })
    }
  },
  moveTodoBackToPending: async (id) => {
    const { weekStart } = get()
    try {
      const result = await apiMoveTodoToPending(id)
      set({
        pending: result.pending.map(mapPending),
        todos: weekStart
          ? result.todos.filter((t) => t.weekStart === weekStart).map(mapTodo)
          : result.todos.map(mapTodo),
        draggingPayload: null,
      })
    } catch (error) {
      console.error('Failed to move todo to pending:', error)
    }
  },
  addTodoFromDrop: async ({ id, title, day }, dayIndex) => {
    const { weekStart } = get()
    if (!weekStart) return
    try {
      const result = await apiAddTodoFromPending({
        id,
        title,
        day,
        dayIndex,
        weekStart,
      })
      set({
        todos: [
          mapTodo(result.todo),
          ...get()
            .todos.filter((t) => t.id !== id)
            .map((t) =>
              t.status === 'active'
                ? { ...t, status: 'pending' as const, startedAtMs: undefined }
                : t
            ),
        ],
        pending: result.pending.map(mapPending),
        draggingPayload: null,
      })
    } catch (error) {
      console.error('Failed to add todo from drop:', error)
    }
  },
  addTodo: async ({ title, dayIndex, estimatedHours = 1 }) => {
    const { weekStart } = get()
    if (!weekStart) return
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      const todo = await apiCreateTodo({
        title: trimmed,
        dayIndex,
        weekStart,
        estimatedHours: normalizeEstimatedHours(estimatedHours),
      })
      set({ todos: [mapTodo(todo), ...get().todos] })
    } catch (error) {
      console.error('Failed to add todo:', error)
    }
  },
  addTodoTree: async ({ dayIndex, parent, subtasks, root }) => {
    const { weekStart } = get()
    if (!weekStart) return
    try {
      const result = await apiCreateTodoTree({
        dayIndex,
        weekStart,
        parent,
        subtasks,
        root,
      })
      const created: TodoItem[] = []
      if (result.root) created.push(mapTodo(result.root))
      if (result.parent) created.push(mapTodo(result.parent))
      if (result.subtasks) created.push(...result.subtasks.map(mapTodo))
      set({ todos: [...created, ...get().todos] })
    } catch (error) {
      console.error('Failed to add todo tree:', error)
      throw error
    }
  },
  startTodo: async (id) => {
    const { weekStart, todos } = get()
    if (!weekStart) return
    try {
      const todo = await apiStartTodo(id, weekStart)
      set({
        todos: todos.map((t) => {
          if (t.id === id) return mapTodo(todo)
          if (t.status === 'active') {
            return { ...t, status: 'pending' as const, startedAtMs: undefined }
          }
          return t
        }),
      })
    } catch (error) {
      console.error('Failed to start todo:', error)
    }
  },
  completeTodo: async (id) => {
    try {
      const todo = await apiCompleteTodo(id)
      set({
        todos: get().todos.map((t) => (t.id === id ? mapTodo(todo) : t)),
      })
    } catch (error) {
      console.error('Failed to complete todo:', error)
    }
  },
  updateTodo: async (id, input) => {
    try {
      const todo = await apiUpdateTodo(id, input)
      set({ todos: get().todos.map((item) => item.id === id ? mapTodo(todo) : item) })
    } catch (error) {
      console.error('Failed to update todo:', error)
      throw error
    }
  },
  addSubtask: async (parentId, input) => {
    const { weekStart, todos } = get()
    const parent = todos.find((item) => item.id === parentId)
    if (!parent || !weekStart) return
    try {
      const todo = await apiCreateSubtask({
        parentId,
        title: input.title,
        description: input.description,
        weekStart,
        dayIndex: parent.dayIndex,
        estimatedMinutes: 30,
      })
      set({ todos: [...get().todos, mapTodo(todo)] })
    } catch (error) {
      console.error('Failed to create subtask:', error)
      throw error
    }
  },
  removeTodo: async (id) => {
    try {
      await apiDeleteTodo(id)
      set({
        todos: get().todos.filter((t) => t.id !== id && t.parentId !== id),
      })
    } catch (error) {
      console.error('Failed to remove todo:', error)
      throw error
    }
  },
  addPending: async ({ title, estimatedHours = 1 }) => {
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      const pending = await apiCreatePending({ title: trimmed, estimatedHours })
      set({ pending: [...get().pending, mapPending(pending)] })
    } catch (error) {
      console.error('Failed to add pending:', error)
    }
  },
  updatePending: async (id, input) => {
    try {
      const pending = await apiUpdatePending(id, input)
      set({
        pending: get().pending.map((p) => (p.id === id ? mapPending(pending) : p)),
      })
    } catch (error) {
      console.error('Failed to update pending:', error)
    }
  },
  removePending: async (id) => {
    try {
      await apiDeletePending(id)
      set({ pending: get().pending.filter((p) => p.id !== id) })
    } catch (error) {
      console.error('Failed to remove pending:', error)
      throw error
    }
  },
}))

export function parseActivityDragPayload(
  dataTransfer: DataTransfer
): ActivityDragPayload | null {
  const raw = dataTransfer.getData('application/json') || dataTransfer.getData('text/plain')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ActivityDragPayload
    if (parsed.kind !== 'week-activity') return null
    if (parsed.source !== 'pending' && parsed.source !== 'todo') return null
    return parsed
  } catch {
    return null
  }
}

export function hasActivityDragPayload(dataTransfer: DataTransfer): boolean {
  return (
    dataTransfer.types.includes('application/json') ||
    dataTransfer.types.includes('text/plain')
  )
}
