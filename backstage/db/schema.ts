import { integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

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
})

export const todoTimeLinks = sqliteTable('todo_time_links', {
  id: text('id').primaryKey(),
  todoId: text('todoId').notNull().references(() => todos.id, { onDelete: 'cascade' }),
  grain: text('grain').notNull(),
  date: text('date').notNull(),
  createdAt: text('createdAt').notNull().default(''),
}, (table) => [
  unique().on(table.todoId, table.grain, table.date),
])

export const todoTimeSpans = sqliteTable('todo_time_spans', {
  id: text('id').primaryKey(),
  todoId: text('todoId').notNull().references(() => todos.id, { onDelete: 'cascade' }),
  startedAt: text('startedAt').notNull(),
  endedAt: text('endedAt'),
  createdAt: text('createdAt').notNull(),
})

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
])

export const executionSessions = sqliteTable('execution_sessions', {
  id: text('id').primaryKey(),
  workItemId: text('workItemId').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  startedAt: text('startedAt').notNull(),
  endedAt: text('endedAt'),
  endReason: text('endReason'),
  note: text('note').notNull().default(''),
})

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
})

export const aaaEntries = sqliteTable('aaa_entries', {
  id: text('id').primaryKey(),
  topicId: text('topicId').notNull().references(() => aaaTopics.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('capture'),
  content: text('content').notNull(),
  week: integer('week'),
  createdAt: text('createdAt').notNull(),
})
