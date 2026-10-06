import 'server-only'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite'
import { migrateTodoDomain } from './todo-migrate'
import { migrateExecutionDomain } from './execution-migrate'

export type AppDatabase = NodeSQLiteDatabase

const dbPath = process.env.DB_FILE_NAME
  ? process.env.DB_FILE_NAME.replace(/^file:/, '')
  : path.join(process.cwd(), 'local.db')

const sqlite = new DatabaseSync(dbPath)

let schemaVersionApplied = 0
const SCHEMA_VERSION = 15

function ensureSchema(): void {
  if (schemaVersionApplied >= SCHEMA_VERSION) return
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    DROP TABLE IF EXISTS llm_interaction_logs;
    DROP TABLE IF EXISTS inbox_items;
    DROP TABLE IF EXISTS tracker_items;
    DROP TABLE IF EXISTS agent_sessions;
    DROP TABLE IF EXISTS agent_presets;
  `)
  migrateTodoDomain(sqlite)
  const todoColumns = sqlite.prepare(`PRAGMA table_info(todos)`).all() as Array<{ name: string }>
  if (!todoColumns.some((column) => column.name === 'aaaTopicId')) {
    sqlite.exec(`ALTER TABLE todos ADD COLUMN aaaTopicId TEXT`)
  }
  sqlite.exec(`
    DROP TABLE IF EXISTS plan_check_ins;
    DROP TABLE IF EXISTS plan_occurrences;
    DROP TABLE IF EXISTS long_term_plans;
  `)
  migrateExecutionDomain(sqlite)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS aaa_topics (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'registry',
      question TEXT NOT NULL DEFAULT '', why TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL DEFAULT '{}', reviewStartedAt TEXT,
      workingStartedAt TEXT, plannedWeeks INTEGER, exitedAt TEXT, exitType TEXT,
      completionRating TEXT, distinctions TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS aaa_entries (
      id TEXT PRIMARY KEY, topicId TEXT NOT NULL REFERENCES aaa_topics(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'capture', content TEXT NOT NULL, week INTEGER, createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS aaa_entries_topic_idx ON aaa_entries(topicId, createdAt);
    CREATE UNIQUE INDEX IF NOT EXISTS aaa_one_active_working ON aaa_topics(status) WHERE status = 'working';
    CREATE INDEX IF NOT EXISTS todos_aaa_topic_idx ON todos(aaaTopicId);
    UPDATE aaa_topics SET status = 'registry' WHERE status = 'research';
  `)
  const aaaColumns = sqlite.prepare(`PRAGMA table_info(aaa_topics)`).all() as Array<{ name: string }>
  if (!aaaColumns.some((column) => column.name === 'description')) {
    sqlite.exec(`ALTER TABLE aaa_topics ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
    sqlite.exec(`UPDATE aaa_topics SET description = COALESCE(NULLIF(question, ''), NULLIF(why, ''), '') WHERE status = 'pool' AND description = ''`)
  }
  if (!aaaColumns.some((column) => column.name === 'links')) sqlite.exec(`ALTER TABLE aaa_topics ADD COLUMN links TEXT NOT NULL DEFAULT '[]'`)
  if (!aaaColumns.some((column) => column.name === 'records')) {
    sqlite.exec(`ALTER TABLE aaa_topics ADD COLUMN records TEXT NOT NULL DEFAULT '[]'`)
    const legacy = sqlite.prepare(`SELECT id, links FROM aaa_topics`).all() as Array<{ id: string; links: string }>
    const update = sqlite.prepare(`UPDATE aaa_topics SET records = ? WHERE id = ?`)
    for (const row of legacy) {
      try {
        const links = JSON.parse(row.links) as unknown
        if (Array.isArray(links)) update.run(JSON.stringify(links.filter((link): link is string => typeof link === 'string').map((link) => ({ content: '', link }))), row.id)
      } catch { /* Preserve the original value for manual recovery. */ }
    }
  }
  const entryColumns = sqlite.prepare(`PRAGMA table_info(aaa_entries)`).all() as Array<{ name: string }>
  if (!entryColumns.some((column) => column.name === 'week')) sqlite.exec(`ALTER TABLE aaa_entries ADD COLUMN week INTEGER`)
  schemaVersionApplied = SCHEMA_VERSION
}

const globalForDb = globalThis as unknown as {
  db: AppDatabase | undefined
}

export function pingDatabase(): void {
  ensureSchema()
  sqlite.prepare('SELECT 1').get()
}

export async function getDatabase(): Promise<AppDatabase> {
  ensureSchema()
  if (!globalForDb.db) {
    globalForDb.db = drizzle({ client: sqlite })
  }
  return globalForDb.db
}

export async function closeDatabase(): Promise<void> {
  globalForDb.db = undefined
  sqlite.close()
}
