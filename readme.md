# Ownspire Navi

独立的个人 Todo 服务：网页里管理本周 / 今天，并通过 MCP 交给 Agent 操作。

任务是独立记录。父子关系用 `parentId`，日 / 周只是时间视图，不是两个文件夹。

## 技术栈

- **前端**：Next.js 16 + React 19 + TypeScript
- **UI**：Radix UI + Tailwind CSS
- **数据库**：SQLite（Drizzle + Node `node:sqlite`）
- **认证**：PIN
- **Agent**：Ownspire Navi Todo MCP

## 快速开始

```bash
npm ci
cp .env.example .env
npm run init-db
npm run dev
```

访问 http://localhost:5500

`.env` 至少配置 `SESSION_SECRET`。首次打开会设置 4 位 PIN，解锁后当天有效，次日需再输入。可在设置页更新 PIN，或运行 `npm run clear-pin` 清除后重新设置。

## MCP

Studio 跑起来之后，再启动 Todo MCP：

```bash
npm run mcp:todo
```

默认连 `http://127.0.0.1:5500/api/todos/gateway`。可用环境变量覆盖：

```env
TODO_GATEWAY_URL=http://127.0.0.1:5500/api/todos/gateway
TODO_GATEWAY_TOKEN=
```

Codex 配置示例（仓库根 `.codex/config.toml`）：

```toml
[mcp_servers.ownspire_navi_todo]
command = "npm"
args = ["run", "mcp:todo"]
cwd = "/Users/token/workspace/ownspire/ownspire-navi"
startup_timeout_sec = 15
tool_timeout_sec = 60
default_tools_approval_mode = "writes"

[mcp_servers.ownspire_navi_todo.env]
TODO_GATEWAY_URL = "http://127.0.0.1:5500/api/todos/gateway"
```

## 项目结构

```
ownspire-navi/
├── app/            # 页面与 API
├── backstage/      # 服务层（todo、执行、db）
├── mcp/            # Todo MCP server
├── types/          # 共享类型
└── components/     # UI 组件
```

## 构建

```bash
npm ci
npm run build
npm start
```
