import 'server-only'
import { nanoid } from 'nanoid'
import { and, asc, desc, eq, inArray, isNull, like, or, type SQL } from 'drizzle-orm'
import { getDatabase } from '@/backstage/db/database'
import { aaaTopics, todoTimeLinks, todos } from '@/backstage/db/schema'
import { parseOutline, type OutlineDraft } from '@/lib/todo-outline'
import { startTodoTimeSpan, stopTodoTimeSpan } from '@/backstage/todo/todo-time-span.service'
import { setTodoTags, tagsForTodos } from '@/backstage/todo/tag.service'
import type {
  CreateTodoInput, TimeGrain, Todo, TodoKind, TodoNoteType, TodoStatus, TodoTimeLink, UpdateTodoInput,
} from '@/types/todo'
import type { Tag } from '@/types/tag'
import { tagIdsOf } from '@/types/tag'
import { isTodayScheduled, isTodoKind, isTimeGrain, isTodoNoteType, TODO_STATUS_LABEL } from '@/types/todo'

const STATUSES = new Set<TodoStatus>(['active', 'pending', 'blocked', 'done', 'cancelled'])
const CASCADE_TO_PENDING_CHILDREN = new Set<TodoStatus>(['blocked', 'cancelled'])
const NOTE_TYPES = new Set<TodoNoteType>(['user', 'status_change'])
const MAX_DEPTH = 6

type TodoRow = {
  id: string; parentId: string | null; sortOrder: number; depth: number
  title: string; description: string; content: string; status: string
  estimatedMinutes: number; kind: string; version: number
  startedAt: string | null; completedAt: string | null
  createdAt: string; updatedAt: string; noteType?: string
  aaaTopicId?: string | null
}

function mapTodo(row: TodoRow, timeLinks: TodoTimeLink[] = [], tags: Tag[] = []): Todo {
  return {
    ...row,
    status: STATUSES.has(row.status as TodoStatus) ? row.status as TodoStatus : 'pending',
    kind: isTodoKind(row.kind) ? row.kind : 'action',
    noteType: isTodoNoteType(row.noteType ?? '') ? row.noteType as TodoNoteType : 'user',
    aaaTopicId: row.aaaTopicId ?? null,
    timeLinks,
    tags,
  }
}

async function loadTimeLinks(ids: string[]): Promise<Map<string, TodoTimeLink[]>> {
  const grouped = new Map<string, TodoTimeLink[]>()
  if (ids.length === 0) return grouped
  const db = await getDatabase()
  const rows = await db.select().from(todoTimeLinks).where(inArray(todoTimeLinks.todoId, ids))
  for (const row of rows) {
    if (!isTimeGrain(row.grain)) continue
    const links = grouped.get(row.todoId) ?? []
    links.push({
      id: row.id,
      todoId: row.todoId,
      grain: row.grain,
      date: row.date,
      createdAt: row.createdAt || `${row.date}T00:00:00.000Z`,
    })
    grouped.set(row.todoId, links)
  }
  return grouped
}

async function withTodoRelations(rows: TodoRow[]): Promise<Todo[]> {
  const ids = rows.map((row) => row.id)
  const [grouped, tags] = await Promise.all([loadTimeLinks(ids), tagsForTodos(ids)])
  return rows.map((row) => mapTodo(row, grouped.get(row.id) ?? [], tags.get(row.id) ?? []))
}

async function requireParent(parentId: string) {
  const db = await getDatabase()
  const [parent] = await db.select({ id: todos.id, depth: todos.depth }).from(todos).where(eq(todos.id, parentId)).limit(1)
  if (!parent) throw new Error(`Todo parent not found: ${parentId}`)
  if (parent.depth >= MAX_DEPTH) throw new Error('Todo maximum depth exceeded')
  return parent
}

function normalizeTimeInput(input: CreateTodoInput): Array<{ grain: TimeGrain; date: string }> {
  const links: Array<{ grain: TimeGrain; date: string }> = []
  const seen = new Set<string>()
  for (const link of input.time ?? []) {
    if (!isTimeGrain(link.grain) || !link.date.trim()) continue
    const key = `${link.grain}:${link.date.trim()}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ grain: link.grain, date: link.date.trim() })
  }
  return links
}

export async function linkTodoTime(todoId: string, grain: TimeGrain, date: string): Promise<Todo> {
  if (!isTimeGrain(grain)) throw new Error(`Invalid time grain: ${grain}`)
  const trimmed = date.trim()
  if (!trimmed) throw new Error('Time link date is required')
  await getTodo(todoId)
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.insert(todoTimeLinks).values({
    id: `time-${grain}-${Date.now()}-${nanoid(6)}`,
    todoId,
    grain,
    date: trimmed,
    createdAt: now,
  }).onConflictDoNothing({ target: [todoTimeLinks.todoId, todoTimeLinks.grain, todoTimeLinks.date] })
  return getTodo(todoId)
}

export async function unlinkTodoTime(todoId: string, grain: TimeGrain, date?: string): Promise<Todo> {
  if (!isTimeGrain(grain)) throw new Error(`Invalid time grain: ${grain}`)
  await getTodo(todoId)
  const db = await getDatabase()
  const filters = [eq(todoTimeLinks.todoId, todoId), eq(todoTimeLinks.grain, grain)]
  if (date) filters.push(eq(todoTimeLinks.date, date))
  await db.delete(todoTimeLinks).where(and(...filters))
  return getTodo(todoId)
}

export async function createTodo(input: CreateTodoInput): Promise<Todo> {
  const title = input.title.trim()
  if (!title) throw new Error('Todo title is required')
  const db = await getDatabase()
  if (input.aaaTopicId) await requireActiveWorking(input.aaaTopicId)
  const parent = input.parentId ? await requireParent(input.parentId) : null
  const now = new Date().toISOString()
  const id = `todo-${Date.now()}-${nanoid(8)}`
  const status = input.status && STATUSES.has(input.status) ? input.status : 'pending'
  if (input.kind != null && !isTodoKind(input.kind)) throw new Error(`Invalid Todo kind: ${input.kind}`)
  const kind: TodoKind = input.kind ?? 'action'
  const noteType = kind === 'note' && input.noteType && NOTE_TYPES.has(input.noteType) ? input.noteType : 'user'
  const parentTodo = input.parentId ? await getTodo(input.parentId) : null
  const inheritedTopicId = input.aaaTopicId === undefined ? parentTodo?.aaaTopicId : null
  const aaaTopicId = input.aaaTopicId !== undefined
    ? input.aaaTopicId
    : inheritedTopicId && await isActiveWorking(inheritedTopicId) ? inheritedTopicId : null
  const time = normalizeTimeInput(input)
  if (parentTodo && kind !== 'note' && kind !== 'rest') {
    for (const link of parentTodo.timeLinks ?? []) {
      if (link.grain === 'day') continue
      if (!time.some((item) => item.grain === link.grain && item.date === link.date)) {
        time.push({ grain: link.grain, date: link.date })
      }
    }
  }
  await db.insert(todos).values({
    id,
    parentId: input.parentId ?? null,
    sortOrder: input.sortOrder ?? 0,
    depth: parent ? parent.depth + 1 : 0,
    title,
    description: input.description?.trim() ?? '',
    content: input.content ?? '',
    status,
    estimatedMinutes: Math.max(0, Math.round(input.estimatedMinutes ?? 0)),
    kind,
    noteType,
    aaaTopicId,
    version: 1,
    startedAt: status === 'active' ? now : null,
    completedAt: status === 'done' ? now : null,
    createdAt: now,
    updatedAt: now,
  })
  for (const link of time) {
    await db.insert(todoTimeLinks).values({
      id: `time-${link.grain}-${Date.now()}-${nanoid(6)}`,
      todoId: id,
      grain: link.grain,
      date: link.date,
      createdAt: now,
    }).onConflictDoNothing({ target: [todoTimeLinks.todoId, todoTimeLinks.grain, todoTimeLinks.date] })
  }
  const copyParentTags = Boolean(parentTodo) && kind !== 'note' && kind !== 'rest' && input.tagIds == null
  const tagIds = input.tagIds ?? (copyParentTags ? tagIdsOf(parentTodo) : [])
  if (tagIds.length > 0) await setTodoTags(id, tagIds)
  if (status === 'active' && kind !== 'note') await startTodoTimeSpan(id)
  return getTodo(id)
}

export async function findRestTodo(): Promise<Todo | null> {
  const db = await getDatabase()
  const [row] = await db.select().from(todos).where(eq(todos.kind, 'rest')).orderBy(asc(todos.createdAt)).limit(1)
  if (!row) return null
  const [todo] = await withTodoRelations([row])
  return todo
}

export async function ensureRestTodo(): Promise<Todo> {
  const existing = await findRestTodo()
  if (existing) return existing
  return createTodo({ title: '休息', kind: 'rest', status: 'pending' })
}

export async function getTodo(id: string): Promise<Todo> {
  const db = await getDatabase()
  const [row] = await db.select().from(todos).where(eq(todos.id, id)).limit(1)
  if (!row) throw new Error(`Todo not found: ${id}`)
  const [todo] = await withTodoRelations([row])
  return todo
}

export async function listTodos(input: {
  parentId?: string | null
  status?: TodoStatus; kind?: TodoKind; query?: string
  grain?: TimeGrain; date?: string
  aaaTopicId?: string
} = {}): Promise<Todo[]> {
  const db = await getDatabase()
  const filters: SQL[] = []
  if (input.parentId !== undefined) {
    filters.push(input.parentId === null ? isNull(todos.parentId) : eq(todos.parentId, input.parentId))
  }
  if (input.status) filters.push(eq(todos.status, input.status))
  if (input.kind) filters.push(eq(todos.kind, input.kind))
  if (input.aaaTopicId) filters.push(eq(todos.aaaTopicId, input.aaaTopicId))
  if (input.query) {
    const pattern = `%${input.query}%`
    const search = or(
      like(todos.title, pattern),
      like(todos.description, pattern),
      like(todos.content, pattern),
    )
    if (search) filters.push(search)
  }
  const rows = await db.select().from(todos)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(todos.sortOrder), desc(todos.createdAt))
  const matched = await withTodoRelations(rows)
  if (!input.grain) return matched
  if (input.grain === 'day' && input.date) {
    return matched.filter((todo) => isTodayScheduled(todo, input.date))
  }
  return matched.filter((todo) => (todo.timeLinks ?? []).some((link) => (
    link.grain === input.grain && (input.date == null || link.date === input.date)
  )))
}

export async function updateTodo(id: string, input: UpdateTodoInput): Promise<Todo> {
  const current = await getTodo(id)
  if (input.aaaTopicId && input.aaaTopicId !== current.aaaTopicId) await requireActiveWorking(input.aaaTopicId)
  if (input.version != null && input.version !== current.version) {
    throw new Error(`Todo version conflict: expected ${input.version}, actual ${current.version}`)
  }
  if (current.kind === 'note' && current.noteType === 'status_change') {
    const locked = ['title', 'description', 'content', 'status', 'kind', 'noteType'] as const
    if (locked.some((field) => input[field] != null && input[field] !== current[field])) {
      throw new Error('Status change notes cannot be edited')
    }
  }
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updatedAt: now, version: current.version + 1 }
  if (input.title != null) {
    if (!input.title.trim()) throw new Error('Todo title is required')
    updates.title = input.title.trim()
  }
  if (input.description != null) updates.description = input.description
  if (input.content != null) updates.content = input.content
  if (input.estimatedMinutes != null) updates.estimatedMinutes = Math.max(0, Math.round(input.estimatedMinutes))
  if (input.kind != null) {
    if (!isTodoKind(input.kind)) throw new Error(`Invalid Todo kind: ${input.kind}`)
    updates.kind = input.kind
  }
  if (input.sortOrder != null) updates.sortOrder = input.sortOrder
  if (input.noteType != null) {
    if (!NOTE_TYPES.has(input.noteType)) throw new Error(`Invalid note type: ${input.noteType}`)
    updates.noteType = input.noteType
  }
  if (input.aaaTopicId !== undefined) updates.aaaTopicId = input.aaaTopicId || null
  const nextStatus = input.status != null && STATUSES.has(input.status) ? input.status : null
  const statusChanged = nextStatus != null && nextStatus !== current.status
  if (nextStatus != null) {
    updates.status = nextStatus
    if (nextStatus === 'active' && !current.startedAt) updates.startedAt = now
    if (nextStatus === 'done') updates.completedAt = now
    else if (current.status === 'done') updates.completedAt = null
  }
  const db = await getDatabase()
  await db.update(todos).set(updates).where(and(eq(todos.id, id), eq(todos.version, current.version)))
  if (statusChanged && current.kind !== 'note') {
    if (nextStatus === 'active') await startTodoTimeSpan(id)
    else await stopTodoTimeSpan(id)
  }
  if (statusChanged && current.kind !== 'note' && current.kind !== 'rest' && current.depth < MAX_DEPTH) {
    await createTodo({
      title: `状态变更：${TODO_STATUS_LABEL[current.status]} → ${TODO_STATUS_LABEL[nextStatus!]}`,
      parentId: id,
      kind: 'note',
      noteType: 'status_change',
      estimatedMinutes: 0,
      sortOrder: await nextSortOrder(id),
    })
  }
  if (statusChanged && current.kind === 'action' && nextStatus && CASCADE_TO_PENDING_CHILDREN.has(nextStatus)) {
    await cascadeStatusToPendingDescendants(id, nextStatus)
  }
  if (input.tagIds != null) await setTodoTags(id, input.tagIds)
  return getTodo(id)
}

async function requireActiveWorking(topicId: string): Promise<void> {
  if (!await isActiveWorking(topicId)) throw new Error('Todo 只能关联当前 Active Working')
}

async function isActiveWorking(topicId: string): Promise<boolean> {
  const db = await getDatabase()
  const [topic] = await db.select({ status: aaaTopics.status }).from(aaaTopics).where(eq(aaaTopics.id, topicId)).limit(1)
  return topic?.status === 'working'
}

async function cascadeStatusToPendingDescendants(parentId: string, status: TodoStatus): Promise<void> {
  const children = await listTodos({ parentId })
  for (const child of children) {
    if (child.kind === 'action' && child.status === 'pending') {
      await updateTodo(child.id, { status })
      continue
    }
    await cascadeStatusToPendingDescendants(child.id, status)
  }
}

export async function updateTodoContent(id: string, input: {
  content: string; mode?: 'replace' | 'append'; version?: number
}): Promise<Todo> {
  const current = await getTodo(id)
  const content = input.mode === 'append' && current.content
    ? `${current.content.trimEnd()}\n\n${input.content}` : input.content
  return updateTodo(id, { content, version: input.version })
}

export async function moveTodo(id: string, input: {
  parentId: string | null; sortOrder?: number; version?: number
}): Promise<Todo> {
  const current = await getTodo(id)
  if (input.version != null && input.version !== current.version) throw new Error('Todo version conflict')
  if (input.parentId === id) throw new Error('Todo cannot be its own parent')
  let depth = 0
  if (input.parentId) {
    let cursor: string | null = input.parentId
    const parent = await requireParent(input.parentId)
    depth = parent.depth + 1
    while (cursor) {
      if (cursor === id) throw new Error('Todo parent cycle detected')
      const row = await getTodo(cursor)
      cursor = row.parentId
    }
  }
  const db = await getDatabase()
  const descendants: Array<{ id: string; depth: number }> = []
  const collectDescendants = async (parentId: string, parentDepth: number) => {
    const children = await db.select({ id: todos.id }).from(todos).where(eq(todos.parentId, parentId))
    for (const child of children) {
      const childDepth = parentDepth + 1
      if (childDepth > MAX_DEPTH) throw new Error('Todo maximum depth exceeded')
      descendants.push({ id: child.id, depth: childDepth })
      await collectDescendants(child.id, childDepth)
    }
  }
  await collectDescendants(id, depth)
  const now = new Date().toISOString()
  db.transaction((trx) => {
    trx.update(todos).set({
      parentId: input.parentId, depth, sortOrder: input.sortOrder ?? 0,
      version: current.version + 1, updatedAt: now,
    }).where(eq(todos.id, id)).run()
    for (const descendant of descendants) {
      trx.update(todos).set({ depth: descendant.depth, updatedAt: now })
        .where(eq(todos.id, descendant.id)).run()
    }
  })
  return getTodo(id)
}

export async function deleteTodo(id: string, cascade = false): Promise<void> {
  const current = await getTodo(id)
  if (current.kind === 'note' && current.noteType === 'status_change') {
    throw new Error('Status change notes cannot be deleted')
  }
  const db = await getDatabase()
  const [child] = await db.select({ id: todos.id }).from(todos).where(eq(todos.parentId, id)).limit(1)
  if (child && !cascade) throw new Error('Todo has children; cascade is required')
  db.transaction((trx) => {
    if (cascade) trx.delete(todos).where(eq(todos.parentId, id)).run()
    trx.delete(todos).where(eq(todos.id, id)).run()
  })
}

async function nextSortOrder(parentId: string | null): Promise<number> {
  const siblings = await listTodos({ parentId })
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((todo) => todo.sortOrder)) + 1
}

async function createOutlineNodes(
  nodes: OutlineDraft[],
  input: { parentId: string | null; time: Array<{ grain: TimeGrain; date: string }> },
  created: Todo[],
): Promise<void> {
  for (const node of nodes) {
    const todo = await createTodo({
      title: node.title,
      parentId: input.parentId,
      kind: node.kind,
      status: node.status,
      time: input.time,
      estimatedMinutes: 0,
      sortOrder: await nextSortOrder(input.parentId),
    })
    created.push(todo)
    if (node.children.length > 0) {
      await createOutlineNodes(node.children, { ...input, parentId: todo.id }, created)
    }
  }
}

export async function importOutline(input: {
  text: string
  weekStart?: string
  parentId?: string | null
  time?: Array<{ grain: TimeGrain; date: string }>
}): Promise<{ created: Todo[]; roots: OutlineDraft[] }> {
  const roots = parseOutline(input.text)
  if (roots.length === 0) throw new Error('大纲为空，没有可导入的条目')
  const time = input.time?.filter((link) => isTimeGrain(link.grain) && link.date.trim())
    ?? (input.weekStart ? [{ grain: 'week' as const, date: input.weekStart }] : [])
  const created: Todo[] = []
  await createOutlineNodes(
    roots,
    {
      parentId: input.parentId ?? null,
      time,
    },
    created,
  )
  return { created, roots }
}
