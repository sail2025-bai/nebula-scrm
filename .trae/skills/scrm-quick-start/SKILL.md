---
name: "scrm-quick-start"
description: "星云企微 SCRM 系统快速上手。当你不确定用哪个 scrm-* 技能、或第一次接入 SCRM 时，Invoke to 了解系统全貌与 tool 映射。"
---

# 星云企微 SCRM · 快速上手

## 你要操作的系统是什么？

星云企微 SCRM 是一套客户关系管理系统，通过 MCP Server 暴露了 **16 个 tools**，覆盖客户台账、订单、分群、日报、群发、事件总线。

## MCP Server 启动（两种模式任选）

### 模式 A：stdio（本地 AI 助手直接拉起）

```bash
cd /path/to/server/src
node mcp-server.js
# 或只读模式（禁止写操作）：
SCRM_MCP_READONLY=true node mcp-server.js
```

### 模式 B：HTTP（远程 AI 助手，支持豆包/火山方舟/Dify）

```bash
# 走现有的 Express server（已内置 /api/mcp 路由）
cd /path/to/server
PORT=3000 node src/index.js

# Server 暴露 3 个 MCP 端点：
#   POST /api/mcp       ← Streamable HTTP（2025-11-25）豆包/火山方舟首选
#   GET  /api/mcp/sse   ← 老 SSE（2024-11-05）兼容旧客户端
#   POST /api/mcp/messages?sessionId=... ← 老 SSE 消息通道
#   GET  /api/mcp/info  ← 公开健康检查（无鉴权）
```

## 三种 AI 助手接入方式

### 1. Trae / Claude Desktop / Cursor（本地 stdio 模式）

在 AI 客户端的 MCP 配置里加：

```json
{
  "mcpServers": {
    "nebula-scrm": {
      "command": "node",
      "args": ["/absolute/path/to/server/src/mcp-server.js"]
    }
  }
}
```

或者 `SCRM_MCP_READONLY=true` 加只读保护。

### 2. 豆包 AI / 火山方舟 Agent（HTTP 模式）

豆包**完全支持 MCP 协议**（stdio + SSE + StreamableHTTP 三种都支持）。在火山方舟配置：

**方案 A：StreamableHTTP（推荐）**

```
端点 URL:  https://your-server.com/api/mcp
方法:      POST
Headers:   Authorization: Bearer neb_xxxxxxxxxxxxxxxxxxxx
```

**方案 B：老 SSE（兼容旧版本豆包）**

```
SSE URL:  https://your-server.com/api/mcp/sse
Headers:   Authorization: Bearer neb_xxxxxxxxxxxxxxxxxxxx
消息:      POST https://your-server.com/api/mcp/messages?sessionId=...
```

**怎么拿 Bearer Token？**
进入 SCRM 管理后台 → 开放平台 → 创建 API Token → scope 选 `read` 或 `read+write` → 复制 token。

### 3. Dify / Coze Bot（远程 HTTP）

在 AI Agent 的"工具"配置里选"MCP Server"类型，填：

```
Server URL:  https://your-server.com/api/mcp
Headers:     {"Authorization": "Bearer neb_xxx"}
```

## 安全说明

| 模式 | 鉴权方式 | 适用场景 |
|------|----------|----------|
| stdio（本地） | 无（默认信任） | 本地开发、个人 AI 助手 |
| HTTP（远程） | Bearer Token | 生产环境、豆包/方舟/Dify 远程调用 |
| HTTP + 只读 Token | `api_tokens.scopes=read` | 第三方只读集成，禁止 create/update |

## 业务模式

系统有两种业务模式（mode），几乎所有查询都支持过滤：

| mode | 典型场景 | 客户特征 |
|------|----------|----------|
| `retail` | 零售/电商/DTC | C 端消费者，关注消费频次、客单价 |
| `service` | 咨询/SaaS/ToB | B 端客户，关注签约额、合同周期 |

## 客户阶段（stage）

| stage | 含义 |
|-------|------|
| `new` | 新客，尚未产生实质消费 |
| `mature` | 成熟期，有消费记录 |
| `loyal` | 忠诚客，高复购高消费 |
| `churn` | 流失风险客，长期无活跃 |

## 16 个 Tools 速查表

### 客户域（4）
| Tool | 能力 | 只读 |
|------|------|------|
| `search_customers` | 按 stage/channel/keyword/min_spend/mode 过滤 | ✅ |
| `get_customer_timeline` | 客户画像 + 订单/跟进/事件时间线 | ✅ |
| `create_customer` | 新建客户（支持初始标签，标签自动 upsert） | ❌ |
| `add_follow_up` | 添加跟进记录（wechat/call/visit/gift/note）| ❌ |

### 订单域（2）
| Tool | 能力 | 只读 |
|------|------|------|
| `list_orders` | 按 status/customer_id/时间范围过滤 | ✅ |
| `update_order_status` | paid→shipped→completed，paid→refunded | ❌ |

### 分析域（2）
| Tool | 能力 | 只读 |
|------|------|------|
| `get_dashboard_stats` | 核心指标（总客/今日新客/复购率/消费） | ✅ |
| `run_custom_analytics` | 白名单表聚合 + 时间粒度 + 分组 | ✅ |

### 分群域（3）
| Tool | 能力 | 只读 |
|------|------|------|
| `list_segments` | 列出所有客群（实时圈选人数） | ✅ |
| `compare_segments` | 两个分群 overlap/union/delta | ✅ |
| `snapshot_segment` | 冻结分群快照 | ❌ |

### 日报域（2）
| Tool | 能力 | 只读 |
|------|------|------|
| `get_daily_report` | 近 N 天日报 | ✅ |
| `generate_daily_report` | 立即生成今日日报 | ❌ |

### 群发 + 事件（3）
| Tool | 能力 | 只读 |
|------|------|------|
| `list_broadcasts` | 群发历史 | ✅ |
| `query_events` | 事件总线（order_paid/chat_keyword 等） | ✅ |
| `create_broadcast` | 创建群发草稿（状态=待下发，安全） | ❌ |

## 选哪个 scrm-* 技能？

| 用户说 | 用哪个 skill |
|--------|-------------|
| "今天经营数据怎么样" / "给我出日报" | `scrm-daily-report` |
| "帮我找流失客户拉回来" / "高价值客户怎么跟" | `scrm-win-back` |
| "给这个客户出跟进建议" / "客户 360 看一下" | `scrm-customer-care` |
| "A 客群和 B 客群有什么区别" | `scrm-segment-analyze` |
| 还不确定 | 继续读本 skill，用 search_customers + timeline 自由探索 |
