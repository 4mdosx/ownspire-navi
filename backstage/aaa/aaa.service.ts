import 'server-only'
import { nanoid } from 'nanoid'
import { desc, eq } from 'drizzle-orm'
import { getDatabase } from '@/backstage/db/database'
import { aaaEntries, aaaTopics } from '@/backstage/db/schema'
import type { AaaEntryKind, AaaPlan, AaaRecord, AaaTopic, AaaWorkflowAction } from '@/types/aaa'

const ENTRY_KINDS = new Set<AaaEntryKind>(['capture', 'progress', 'evidence', 'review'])
const MAX_WEEKS = 10

function parse<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

function normalizedRecords(value: unknown): AaaRecord[] {
  if (!Array.isArray(value)) throw new Error('记录格式无效')
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.content !== 'string' || typeof item.link !== 'string') throw new Error('记录需要内容和链接字段')
    const content = item.content.trim()
    const link = item.link.trim()
    if (!content && !link) return null
    if (!link) return { content, link }
    try {
      const url = new URL(link)
      if (url.protocol === 'http:' || url.protocol === 'https:') return { content, link }
    } catch { /* handled below */ }
    throw new Error('链接必须是 http:// 或 https:// 地址')
  }).filter((item): item is AaaRecord => item !== null)
}

function normalizedPlan(value: AaaPlan): AaaPlan {
  const goals = value.weeklyGoals ?? []
  if (!Array.isArray(goals) || goals.length > MAX_WEEKS || goals.some((goal) => typeof goal !== 'string')) {
    throw new Error('每期 Working 最多 10 周，且每周目标必须是文本')
  }
  return { ...value, weeklyGoals: goals.map((goal) => goal.trim()) }
}

function mapTopic(row: typeof aaaTopics.$inferSelect, entries: typeof aaaEntries.$inferSelect[] = []): AaaTopic {
  const records = parse<unknown>(row.records, [])
  return {
    ...row,
    status: row.status as AaaTopic['status'],
    records: Array.isArray(records) ? records.filter((record): record is AaaRecord => Boolean(record && typeof record === 'object' && typeof record.content === 'string' && typeof record.link === 'string')) : [],
    plan: parse<AaaPlan>(row.plan, {}),
    exitType: row.exitType as AaaTopic['exitType'],
    completionRating: row.completionRating as AaaTopic['completionRating'],
    distinctions: parse(row.distinctions, []),
    entries: entries.map((entry) => ({ ...entry, kind: entry.kind as AaaEntryKind })),
  }
}

export async function listAaaTopics(): Promise<AaaTopic[]> {
  const db = await getDatabase()
  const [rows, entries] = await Promise.all([
    db.select().from(aaaTopics).orderBy(desc(aaaTopics.updatedAt)),
    db.select().from(aaaEntries).orderBy(desc(aaaEntries.createdAt)),
  ])
  return rows.map((row) => mapTopic(row, entries.filter((entry) => entry.topicId === row.id)))
}

export async function getAaaTopic(id: string): Promise<AaaTopic> {
  const db = await getDatabase()
  const [row] = await db.select().from(aaaTopics).where(eq(aaaTopics.id, id)).limit(1)
  if (!row) throw new Error('AAA Topic 不存在')
  const entries = await db.select().from(aaaEntries).where(eq(aaaEntries.topicId, id)).orderBy(desc(aaaEntries.createdAt))
  return mapTopic(row, entries)
}

export async function createAaaTopic(input: { title: string; description?: string; records?: AaaRecord[] }): Promise<AaaTopic> {
  const title = input.title?.trim()
  if (!title) throw new Error('Topic 标题不能为空')
  const db = await getDatabase()
  const now = new Date().toISOString()
  const id = `aaa-${Date.now()}-${nanoid(7)}`
  await db.insert(aaaTopics).values({
    id, title, description: input.description?.trim() ?? '', records: JSON.stringify(normalizedRecords(input.records ?? [])),
    status: 'pool', createdAt: now, updatedAt: now,
  })
  return getAaaTopic(id)
}

export async function updateAaaTopic(id: string, input: Partial<AaaTopic>): Promise<AaaTopic> {
  const current = await getAaaTopic(id)
  if (input.status !== undefined && input.status !== current.status) throw new Error('请通过对应流程切换 Lifecycle')
  if ((input.exitType !== undefined && input.exitType !== current.exitType) ||
    (input.exitedAt !== undefined && input.exitedAt !== current.exitedAt)) {
    throw new Error('请通过 Working 退出流程设置结果')
  }
  const updates: Partial<typeof aaaTopics.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new Error('Topic 标题不能为空')
    updates.title = input.title.trim()
  }
  if (input.description !== undefined) updates.description = input.description.trim()
  if (input.records !== undefined) updates.records = JSON.stringify(normalizedRecords(input.records))
  if (current.status !== 'pool') {
    for (const key of ['question', 'scope', 'notes'] as const) {
      if (input[key] !== undefined) updates[key] = input[key]!.trim()
    }
    if (input.plan !== undefined) {
      if (current.status === 'working' || current.status === 'archive') throw new Error('Working 计划只能在 Registry 或评审周修订')
      const plan = normalizedPlan(input.plan)
      updates.plan = JSON.stringify(plan)
      updates.plannedWeeks = plan.weeklyGoals?.length || null
    }
    if (input.completionRating !== undefined) updates.completionRating = input.completionRating
    if (input.distinctions !== undefined) updates.distinctions = JSON.stringify(input.distinctions)
  }
  const db = await getDatabase()
  await db.update(aaaTopics).set(updates).where(eq(aaaTopics.id, id))
  return getAaaTopic(id)
}

export async function transitionAaaTopic(id: string, action: AaaWorkflowAction, input: { title?: string; description?: string; records?: AaaRecord[]; question?: string; scope?: string; reason?: string; confirmEarly?: boolean } = {}): Promise<AaaTopic> {
  const topic = await getAaaTopic(id)
  const now = new Date().toISOString()
  const changes: Partial<typeof aaaTopics.$inferInsert> = { updatedAt: now }
  if (action === 'open' && topic.status === 'pool') {
    if (!input.question?.trim() || !input.scope?.trim()) throw new Error('开题需要填写核心问题和 Scope / 边界')
    if (!input.title?.trim()) throw new Error('Topic 标题不能为空')
    Object.assign(changes, { status: 'registry', title: input.title.trim(), description: input.description?.trim() ?? '', records: JSON.stringify(normalizedRecords(input.records ?? [])), question: input.question.trim(), scope: input.scope.trim() })
  } else if (action === 'beginReview' && topic.status === 'registry') {
    const others = await listAaaTopics()
    if (others.some((candidate) => candidate.status === 'working')) throw new Error('Active Working 期间不能准备下一期评审')
    const recentExit = others.filter((candidate) => candidate.exitedAt && (candidate.exitType === 'freeze' || candidate.exitType === 'terminate'))
      .sort((a, b) => (b.exitedAt ?? '').localeCompare(a.exitedAt ?? ''))[0]
    if (recentExit?.exitedAt && Date.now() - Date.parse(recentExit.exitedAt) < 7 * 24 * 60 * 60 * 1000) throw new Error('冻结或撤销后需至少休息 7 天，才能进入评审')
    changes.status = 'review'
    changes.reviewStartedAt = now
  } else if (action === 'approve' && topic.status === 'review') {
    const goals = topic.plan.weeklyGoals ?? []
    if (goals.length < 1 || goals.length > MAX_WEEKS || goals.some((goal) => !goal.trim())) throw new Error('请先保存 1–10 条完整的每周目标')
    if (!topic.reviewStartedAt || Number.isNaN(Date.parse(topic.reviewStartedAt))) throw new Error('评审开始时间无效')
    if (Date.now() - Date.parse(topic.reviewStartedAt) < 7 * 24 * 60 * 60 * 1000 && input.confirmEarly !== true) {
      throw new Error('建议评审满 7 天；如需提前开始 Working，请再次确认')
    }
    if ((await listAaaTopics()).some((candidate) => candidate.status === 'working' && candidate.id !== id)) throw new Error('同一时间只能有一个 Active Working')
    changes.status = 'working'
    changes.workingStartedAt = now
    changes.plannedWeeks = goals.length
    changes.exitType = null
    changes.exitedAt = null
  } else if (topic.status === 'working' && ['accept', 'freeze', 'cancel'].includes(action)) {
    if (!input.reason?.trim()) throw new Error('请记录本次退出的结论或原因')
    if (action === 'freeze') {
      changes.status = 'registry'
      changes.exitType = 'freeze'
      changes.reviewStartedAt = null
    } else {
      changes.status = 'archive'
      changes.exitType = action === 'accept' ? 'closing' : 'terminate'
    }
    changes.exitedAt = now
  } else {
    throw new Error('当前阶段不支持此操作')
  }
  const db = await getDatabase()
  await db.update(aaaTopics).set(changes).where(eq(aaaTopics.id, id))
  if (input.reason?.trim()) {
    await db.insert(aaaEntries).values({
      id: `entry-${Date.now()}-${nanoid(7)}`, topicId: id,
      kind: 'review', content: input.reason.trim(), createdAt: now,
    })
  }
  return getAaaTopic(id)
}

export async function addAaaEntry(topicId: string, input: { kind?: AaaEntryKind; content: string }): Promise<AaaTopic> {
  await getAaaTopic(topicId)
  const content = input.content.trim()
  if (!content) throw new Error('记录内容不能为空')
  const kind = input.kind ?? 'capture'
  if (!ENTRY_KINDS.has(kind)) throw new Error('无效的记录类型')
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.insert(aaaEntries).values({ id: `entry-${Date.now()}-${nanoid(7)}`, topicId, kind, content, createdAt: now })
  await db.update(aaaTopics).set({ updatedAt: now }).where(eq(aaaTopics.id, topicId))
  return getAaaTopic(topicId)
}

export async function addAaaWeekNote(topicId: string, input: { week: number; content: string }): Promise<AaaTopic> {
  const topic = await getAaaTopic(topicId)
  if (topic.status !== 'working') throw new Error('只能为 Active Working 记录每周备注')
  const week = input.week
  const elapsedWeek = topic.workingStartedAt ? Math.max(1, Math.floor((Date.now() - Date.parse(topic.workingStartedAt)) / (7 * 24 * 60 * 60 * 1000)) + 1) : 1
  if (!Number.isInteger(week) || week < 1 || week > Math.max(topic.plannedWeeks ?? 0, elapsedWeek)) throw new Error('周次不在当前 Working 范围内')
  const content = input.content?.trim()
  if (!content) throw new Error('备注内容不能为空')
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.insert(aaaEntries).values({ id: `entry-${Date.now()}-${nanoid(7)}`, topicId, kind: 'weekly_note', week, content, createdAt: now })
  await db.update(aaaTopics).set({ updatedAt: now }).where(eq(aaaTopics.id, topicId))
  return getAaaTopic(topicId)
}

export async function deleteAaaTopic(id: string): Promise<void> {
  const topic = await getAaaTopic(id)
  if (topic.status !== 'pool') throw new Error('只能删除 Pool 中的记录')
  const db = await getDatabase()
  await db.delete(aaaTopics).where(eq(aaaTopics.id, id))
}
