import { foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { desc, sql } from 'drizzle-orm'

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updatedAt').notNull(),
})

export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  parentId: text('parentId'),
  sortOrder: integer('sortOrder').notNull().default(0),
  depth: integer('depth').notNull().default(0),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  content: text('content').notNull().default(''),
  status: text('status').notNull().default('pending'),
  estimatedMinutes: integer('estimatedMinutes').notNull().default(0),
  kind: text('kind').notNull().default('action'),
  version: integer('version').notNull().default(1),
  startedAt: text('startedAt'),
  completedAt: text('completedAt'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
  noteType: text('noteType').notNull().default('user'),
  aaaTopicId: text('aaaTopicId'),
}, (table) => [
  // ⭐ 自引用：parentId 指向同一张表的 id。todos 是一棵树，靠它级联删子树。
  // schema 里原先漏了这条 REFERENCES —— 旧库 SQL 里有
  // （`parentId TEXT REFERENCES todos(id) ON DELETE CASCADE`），迁移前是靠它
  // 做级联的，漏掉会让「删父节点留下孤儿子树」这个静默错误重新出现。
  foreignKey({
    columns: [table.parentId],
    foreignColumns: [table.id],
    name: 'todos_parentId_fk',
  }).onDelete('cascade'),
  index('idx_todos_parent_sort').on(table.parentId, table.sortOrder),
  index('idx_todos_status_updated').on(table.status, desc(table.updatedAt)),
  index('idx_todos_kind').on(table.kind),
  index('todos_aaa_topic_idx').on(table.aaaTopicId),
])

export const todoTimeLinks = sqliteTable('todo_time_links', {
  id: text('id').primaryKey(),
  todoId: text('todoId').notNull().references(() => todos.id, { onDelete: 'cascade' }),
  grain: text('grain').notNull(),
  date: text('date').notNull(),
  createdAt: text('createdAt').notNull().default(''),
}, (table) => [
  unique().on(table.todoId, table.grain, table.date),
  index('idx_todo_time_links_lookup').on(table.grain, table.date, table.todoId),
])

export const todoTimeSpans = sqliteTable('todo_time_spans', {
  id: text('id').primaryKey(),
  todoId: text('todoId').notNull().references(() => todos.id, { onDelete: 'cascade' }),
  startedAt: text('startedAt').notNull(),
  endedAt: text('endedAt'),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('idx_todo_time_spans_range').on(table.startedAt, table.endedAt),
  index('idx_todo_time_spans_todo').on(table.todoId, table.startedAt),
  // ⭐ 部分索引：只索引「还没结束」的 span。查询永远是「这个 todo 有没有
  // 正在进行的时间段」，而历史 span 会一直堆积 —— 全表索引会跟着一起膨胀，
  // 而它占的每一格都是白占。
  index('idx_todo_time_spans_open').on(table.todoId).where(sql`${table.endedAt} IS NULL`),
])

export const workItems = sqliteTable('work_items', {
  id: text('id').primaryKey(),
  sourceType: text('sourceType').notNull(),
  sourceId: text('sourceId').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  scheduledDate: text('scheduledDate').notNull(),
  queueOrder: integer('queueOrder').notNull().default(0),
  priority: text('priority').notNull().default('normal'),
  state: text('state').notNull().default('ready'),
  plannedMinutes: integer('plannedMinutes').notNull(),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  unique().on(table.sourceType, table.sourceId, table.scheduledDate),
  index('idx_work_items_today').on(table.scheduledDate, table.queueOrder),
])

export const executionSessions = sqliteTable('execution_sessions', {
  id: text('id').primaryKey(),
  workItemId: text('workItemId').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  startedAt: text('startedAt').notNull(),
  endedAt: text('endedAt'),
  endReason: text('endReason'),
  note: text('note').notNull().default(''),
}, (table) => [
  index('idx_sessions_item').on(table.workItemId, table.startedAt),
])

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
})

export const todoTags = sqliteTable('todo_tags', {
  todoId: text('todoId').notNull().references(() => todos.id, { onDelete: 'cascade' }),
  tagId: text('tagId').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  primaryKey({ columns: [table.todoId, table.tagId] }),
  index('idx_todo_tags_tag').on(table.tagId),
])

export const focusModes = sqliteTable('focus_modes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  includeTags: text('includeTags').notNull().default('["*"]'),
  excludeTags: text('excludeTags').notNull().default('[]'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
})

export const aaaTopics = sqliteTable('aaa_topics', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  links: text('links').notNull().default('[]'),
  records: text('records').notNull().default('[]'),
  status: text('status').notNull().default('pool'),
  question: text('question').notNull().default(''),
  why: text('why').notNull().default(''),
  scope: text('scope').notNull().default(''),
  notes: text('notes').notNull().default(''),
  plan: text('plan').notNull().default('{}'),
  reviewStartedAt: text('reviewStartedAt'),
  workingStartedAt: text('workingStartedAt'),
  plannedWeeks: integer('plannedWeeks'),
  exitedAt: text('exitedAt'),
  exitType: text('exitType'),
  completionRating: text('completionRating'),
  distinctions: text('distinctions').notNull().default('[]'),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
}, (table) => [
  // ⭐ 同一时刻**只能有一个** topic 处于 working —— 这是「Working 周」这套
  // 工作流的硬约束。用部分唯一索引把这条规则交给数据库，而不是靠每次写入
  // 前先查一遍（那会漏掉并发下的双开）。
  uniqueIndex('aaa_one_active_working').on(table.status).where(sql`${table.status} = 'working'`),
])

export const aaaEntries = sqliteTable('aaa_entries', {
  id: text('id').primaryKey(),
  topicId: text('topicId').notNull().references(() => aaaTopics.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('capture'),
  content: text('content').notNull(),
  week: integer('week'),
  createdAt: text('createdAt').notNull(),
}, (table) => [
  index('aaa_entries_topic_idx').on(table.topicId, table.createdAt),
])
