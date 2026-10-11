#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const gatewayUrl = process.env.TODO_GATEWAY_URL?.trim() || 'http://127.0.0.1:5500/api/todos/gateway'
const token = process.env.TODO_GATEWAY_TOKEN?.trim()

async function gateway(operation: string, args: Record<string, unknown>) {
  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ requestId: crypto.randomUUID(), operation, arguments: args }),
  })
  const result = await response.json() as { success: boolean; data?: unknown; error?: string }
  if (!response.ok || !result.success) throw new Error(result.error || `Todo gateway failed (${response.status})`)
  return result.data
}

const server = new McpServer(
  { name: 'ownspire-navi-todo', version: '1.0.0' },
  {
    instructions:
      'Ownspire Navi Todo tasks are independent records. Associate them with parents via parentId and with day/week via time links. Day and week are views, not folders. Capture work as written, do not auto-split or invent estimates. Hang derived subtasks under the current parent. Read a todo before updating it and pass version on writes.',
  }
)

function result(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

const status = z.enum(['active', 'pending', 'blocked', 'done', 'cancelled'])
const kind = z.enum(['action', 'note'])
const timeGrain = z.enum(['day', 'week', 'horizon'])
const timeLink = z.object({ grain: timeGrain, date: z.string().min(1) })

server.registerTool('todo_list', {
  description: 'List and search Ownspire Navi todos.',
  inputSchema: {
    grain: timeGrain.optional(), date: z.string().optional(),
    parentId: z.string().nullable().optional(), status: status.optional(), kind: kind.optional(),
    query: z.string().optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async (args) => result(await gateway('todo.list', args)))

server.registerTool('todo_get', {
  description: 'Read one todo, including its current version and execution state.',
  inputSchema: { id: z.string().min(1) },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async (args) => result(await gateway('todo.get', args)))

server.registerTool('todo_create', {
  description: 'Create a root todo or subtask in the canonical Ownspire Navi Todo domain.',
  inputSchema: {
    title: z.string().min(1), description: z.string().optional(), content: z.string().optional(),
    parentId: z.string().nullable().optional(), status: status.optional(),
    estimatedMinutes: z.number().int().nonnegative().optional(),
    kind: kind.optional(),
    time: z.array(timeLink).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (args) => result(await gateway(args.parentId ? 'todo.create_subtask' : 'todo.create', args)))

server.registerTool('todo_update', {
  description: 'Update todo definition or lifecycle state. Read first and pass version.',
  inputSchema: {
    id: z.string().min(1), version: z.number().int().positive(), title: z.string().min(1).optional(),
    description: z.string().optional(), status: status.optional(), estimatedMinutes: z.number().int().nonnegative().optional(),
    kind: kind.optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (args) => result(await gateway('todo.update', args)))

server.registerTool('todo_update_content', {
  description: 'Replace or append to the execution checkpoint stored in todo.content.',
  inputSchema: {
    id: z.string().min(1), version: z.number().int().positive(),
    mode: z.enum(['replace', 'append']).default('append'), content: z.string(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (args) => result(await gateway('todo.update_content', args)))

server.registerTool('todo_move', {
  description: 'Move or reorder a todo without creating cycles.',
  inputSchema: {
    id: z.string().min(1), version: z.number().int().positive(),
    parentId: z.string().nullable(), sortOrder: z.number().int().min(0).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (args) => result(await gateway('todo.move', args)))

server.registerTool('todo_import_outline', {
  description: 'Import a weekly notes-style outline into Ownspire Navi as nested tasks and notes. Checkmarks become done. Do not auto-split items.',
  inputSchema: {
    text: z.string().min(1),
    weekStart: z.string().optional(),
    parentId: z.string().nullable().optional(),
    time: z.array(timeLink).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (args) => result(await gateway('todo.import_outline', args)))

server.registerTool('todo_link_time', {
  description: 'Associate an existing todo with a day or week. Does not move or copy the todo.',
  inputSchema: {
    id: z.string().min(1),
    grain: timeGrain,
    date: z.string().min(1),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (args) => result(await gateway('todo.link_time', args)))

server.registerTool('todo_unlink_time', {
  description: 'Remove a day or week association from a todo. The todo itself stays.',
  inputSchema: {
    id: z.string().min(1),
    grain: timeGrain,
    date: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async (args) => result(await gateway('todo.unlink_time', args)))

server.registerTool('todo_delete', {
  description: 'Delete a todo. Cascade deletion must be explicitly requested.',
  inputSchema: { id: z.string().min(1), cascade: z.boolean().default(false), confirm: z.literal(true) },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
}, async (args) => result(await gateway('todo.delete', args)))

async function main() {
  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  console.error('Todo MCP server failed:', error)
  process.exit(1)
})
