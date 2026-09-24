# 星云企微 SCRM 系统说明

> 私域智慧运营与客户资产管理中心 · Nebula WeCom SCRM

---

## 目录

- [1. 项目概览](#1-项目概览)
- [2. 技术栈](#2-技术栈)
- [3. 快速启动](#3-快速启动)
- [4. 架构总览](#4-架构总览)
- [5. 核心模块详解](#5-核心模块详解)
  - [5.1 SOP 自动化引擎](#51-sop-自动化引擎)
  - [5.2 Dashboard 工作台](#52-dashboard-工作台)
  - [5.3 客户管理](#53-客户管理)
  - [5.4 企微集成](#54-企微集成)
  - [5.5 短信群发](#55-短信群发)
  - [5.6 标签 / 优惠券 / 渠道码](#56-标签--优惠券--渠道码)
- [6. SOP 分层执行机制](#6-sop-分层执行机制)
- [7. SOP Scope 作用域机制](#7-sop-scope-作用域机制)
- [8. 数据模型](#8-数据模型)
- [9. 权限模型](#9-权限模型)
- [10. API 路由清单](#10-api-路由清单)
- [11. 定时调度器](#11-定时调度器)
- [12. 业务模式（retail / service）](#12-业务模式retail--service)
- [13. 目录结构](#13-目录结构)

---

## 1. 项目概览

星云企微 SCRM 是一套面向私域运营场景的企业微信客户关系管理系统，核心能力包括：

| 能力 | 说明 |
|------|------|
| **客户资产** | 从企微/渠道导入客户，分层打标签、记订单、算阶段 |
| **SOP 自动化** | 可配置的自动化触达流程，支持企微消息 / 入群 / 券 / 电话等多动作 |
| **Dashboard 工作台** | 顾问每日待办、关键指标、销售漏斗 |
| **营销触达** | 短信群发、渠道码活码、企微群管理 |
| **会话存档** | 企微会话存档轮询，敏感词监控与自动打标 |
| **标签与优惠券** | 客户标签体系、优惠券发放核销 |
| **数据报表** | 日报、转化漏斗、SOP 效果追踪 |

**业务模式**：系统同时支持 C 端零售（`retail`）和 B 端企服（`service`），两种模式下的 SOP 模板、报表口径、字段粒度不同。

---

## 2. 技术栈

### 后端

| 组件 | 技术 | 版本 |
|------|------|------|
| 运行时 | Node.js (ESM) | ≥ 20 |
| Web 框架 | Express | ^4.21 |
| 数据库 | SQLite (better-sqlite3, WAL 模式) | ^12 |
| 鉴权 | JWT + API Token | jsonwebtoken ^9 |
| 参数校验 | Zod | ^4 |
| 安全 | helmet + cors + express-rate-limit | - |
| 企微集成 | 原生 fetch 调用 WeCom OpenAPI | - |
| 调度器 | 内置 setTimeout 递归（无 cron 依赖） | - |
| 日志 | 自研 log() 函数（文件 + 控制台） | - |

### 前端

| 组件 | 技术 | 版本 |
|------|------|------|
| 框架 | React | ^18.3 |
| 构建 | Vite | 5.x |
| 语言 | TypeScript | 5.x |
| 图表 | Chart.js + react-chartjs-2 | ^4 / ^5 |
| 图标 | Font Awesome 6 | - |
| 样式 | Tailwind CSS | 3.x |

### 部署形态

- **后端**：单进程 Node.js，端口 3001，SQLite 内嵌，零外部依赖
- **前端**：`npm run build` 产物由 Express 托管（`/` 路由）
- **数据库**：`server/data/scrm.db`（WAL 模式，-wal / -shm 文件忽略）

---

## 3. 快速启动

```bash
# 1. 安装依赖
cd server && npm install
cd ../client && npm install

# 2. 启动后端（端口 3001，热重载）
cd server && npm run dev

# 3. 启动前端开发服务器（端口 5173）
cd client && npm run dev

# 4. 或生产构建（前端产物嵌入后端）
cd client && npm run build
cd ../server && npm start

# 5. 首次启动会自动创建 SQLite 数据库并初始化 schema，
#    也可以手动灌入种子数据：
cd server && npm run seed
```

**默认端口**：后端 3001，前端 dev 5173。前端 build 后全部走后端 `localhost:3001`。

---

## 4. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React + Vite)                 │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Dashboard│ │  SOP     │ │ Customers│ │ Broadcast / Qr │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───────┬───────┘  │
│       │            │            │                │          │
│       └────────────┴─────┬──────┴────────────────┘          │
│                          │ api.ts (统一 fetch)              │
└──────────────────────────┼──────────────────────────────────┘
                           │ HTTP / JSON
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Backend (Express, :3001)                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Auth Middleware (JWT / API Token)       │    │
│  └────────────────────────┬────────────────────────────┘    │
│                           ▼                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  routes   │ │  utils   │ │  wecom   │ │scheduler │       │
│  │ (REST)    │ │ (SOP等)  │ │ (企微API)│ │ (定时器) │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│       └────────────┴─────┬──────┴────────────┘             │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │     SQLite (better-sqlite3, WAL, 单文件 scrm.db)     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │     WeCom OpenAPI（企微客户消息 / 入群 / 会话存档）    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 关键入口文件

| 文件 | 职责 |
|------|------|
| `server/src/index.js` | Express 启动，挂载全部 routes + 托管前端 build，启动 scheduler |
| `server/src/db.js` | better-sqlite3 初始化 + WAL + initSchema 迁移 + 工具函数 |
| `server/src/scheduler.js` | 每日归零 / 会话存档轮询 / SOP 日触达 / 日报 4 个定时器 |
| `server/src/wecom.js` | 企微 access_token 缓存、客户消息、入群、企微登录 |
| `server/src/utils/sop-engine.js` | SOP 分层执行引擎（单次 + 批量，核心） |
| `server/src/utils/events.js` | 事件驱动 SOP 匹配（客户加企微 / 首购 / 入群） |

---

## 5. 核心模块详解

### 5.1 SOP 自动化引擎

SOP 是一条可配置的客户自动化触达流程，包含：

| 要素 | 枚举 | 说明 |
|------|------|------|
| **trigger_type** | `add_friend` / `first_purchase` / `days_inactive` / `high_value` / `chat_join` / `churn_warning` / `custom` | 触发条件类型 |
| **trigger_days** | number | days_inactive 专用，沉睡天数阈值 |
| **trigger_min_spend** | number | high_value 专用，最低消费阈值 |
| **scope** | `all` / `mine` | 作用域（[详见 §7](#7-sop-scope-作用域机制)） |
| **steps** | `[{ action, title, detail, delay_days, message_template, ... }]` | 多步动作序列 |
| **conditions** | 嵌套 AND/OR 条件树 | 自定义客户筛选条件（field + op + value） |
| **mode** | `retail` / `service` | 业务模式隔离 |

**Action 类型（分层）**——详见 [§6](#6-sop-分层执行机制)：

| Action | 分层 | outcome | 进 Dashboard 待办 |
|--------|------|---------|-------------------|
| `send_wechat` | 自动 | 自动执行 / 降级未发 | ❌ |
| `invite_group` | 自动 | 自动执行 / 降级未发 | ❌ |
| `push_coupon` | 自动 | 自动执行 | ❌ |
| `assign_staff` | 自动 | 自动执行 | ❌ |
| `note_mark` | 自动 | 自动执行 | ❌ |
| `phone_call` | 人工 | 待处理 | ✅ |
| `gift_send` | 人工 | 待处理 | ✅ |

**执行入口（全链路统一走 sop-engine.js）**：

| 入口 | 文件 | scope=mine 行为 |
|------|------|-----------------|
| 手动 `POST /sops/:id/run` | `routes/sops.js` | ✅ 带 staffId 过滤 |
| `scheduler.js` 每日沉睡客户触达 | `scheduler.js` | ⚠️ 跳过 mine |
| `events.js` 客户加企微 / 首购事件 | `utils/events.js` | ⚠️ 跳过 mine |

### 5.2 Dashboard 工作台

`GET /api/dashboard/summary` 返回：

- **metrics 区**：客户总数、本月新增、待办跟进、运行中 SOP、本月销售额、会话消息
- **pending_followups**：**只展示** `sop_phone_call` / `sop_gift_send` / 非 SOP 手工跟进；自动执行类 follow_up（sop_send_wechat 等）**不出现在待办列表**
- **today_triggered**：今日 SOP 触发条数
- **staff_performance**：顾问业绩排行
- **channel_breakdown**：渠道来源分布

前端 DashboardView 展示：指标卡 + 销售漏斗 + SOP 运行历史 + 顾问业绩 Top + 今日待办列表（含「标记完成」按钮）。

### 5.3 客户管理

`GET /api/customers` 支持分页 + 多维度筛选（stage / channel / staff_id / tags / spend / orders）。

客户 stage 枚举：`new`（新客）/ `mature`（成熟）/ `churn`（流失预警）/ `vip`。

### 5.4 企微集成

企微 API 凭据存放在 `wecom_config` 表（单例 row，通过 `wecomConfig()` 函数读取）。支持两套凭据：

| 用途 | 配置字段 | API |
|------|----------|-----|
| 外部客户消息 / 入群 | `corp_id` + `corp_secret` | `/cgi-bin/message/add_msg_template` + `externalcontact/add_msg_template` / `groupchat/addchat` |
| 内部员工通知 | `app_agent_id` + `app_secret` | `/cgi-bin/message/send`（touser: @all 或指定 staff wecom_userid） |
| 企微侧边栏登录 | `corp_id` + `corp_secret` | `/cgi-bin/auth/getuserinfo` + `/cgi-bin/user/get` |
| 会话存档 | `corp_id` + `corp_secret` + `msg_audit_private_key` | `/cgi-bin/msgaudit/get_chat_7day` |

所有企微 API 都走 `callWecomApi()` 包装，自动缓存 access_token（2h TTL）。**凭据缺失时降级为 simulated，不阻塞主流程**。

### 5.5 短信群发

`POST /api/broadcasts` 创建群发计划，`POST /api/broadcasts/:id/send` 触发下发。当前为模拟模式（写 broadcasts 表 + 日志），对接真实短信网关只需替换 `utils/sms.js` 中的 `sendSms` 函数。

### 5.6 标签 / 优惠券 / 渠道码

| 模块 | 功能 |
|------|------|
| **Tags** | 客户打标签 / 移除标签，支持批量操作，SOP 条件构建器动态下拉 |
| **Coupons** | 优惠券创建 + 发放 + 核销，支持限制适用范围 |
| **QRCodes** | 渠道码/活码，生成带 scene 的企微加好友二维码 |
| **Groups** | 企微群管理，关联 wecom_external_userid，SOP 可 invite_group |

---

## 6. SOP 分层执行机制

### 核心思路

**自动执行类 action 直接调企微 API，不进 Dashboard 待办；只有 phone_call / gift_send 这种需要人工的才写 follow_up(outcome=待处理)。**

### 执行流程

```
executeStep(action, customer, sop, ctx)
  │
  ├── send_wechat / invite_group / ...
  │     ├── 调企微 API → outcome='自动执行:已发送'
  │     └── 降级（无凭据） → outcome='降级未发:企微未配置'
  │     └── 写 wecom_events（event_type='sop_step_intent', change_type='sent'/'simulated'）
  │     └── 不写 follow_up（或写 outcome=自动执行，TYPE_FILTER 会过滤掉）
  │
  ├── phone_call / gift_send
  │     ├── 写 follow_up(outcome='待处理', type='sop_phone_call' / 'sop_gift_send')
  │     └── 推内部企微通知给对应顾问
  │     └── Dashboard DashboardView 可见
  │
  └── push_coupon / assign_staff / note_mark
        └── 自动执行，不进待办
```

### 降级机制

所有企微 API 调用都包在 try/catch 里，失败时返回 `{ simulated: true, outcome: '降级未发:...', error: ... }`，主流程继续执行，不阻塞后续步骤。

---

## 7. SOP Scope 作用域机制

| | scope=all（系统级） | scope=mine（私人） |
|---|---|---|
| **谁能建** | 仅 admin（users.account='admin'） | 所有登录用户 |
| **谁能改/删** | 仅 admin | 创建本人 + admin |
| **对哪些客户生效** | 全部客户 | 仅 `staff_id = 自己` 的客户 |
| **谁触发执行** | 手动 run ✅ scheduler ✅ events ✅ | **仅手动 run**（后台没有执行人，不知道用谁的 staffId） |

后端强约束：`matchSopCustomers(sop, limit, staffId)`，staffId 非空时追加 `AND customers.staff_id = ?`。

前端软过滤（非 admin）：列表只展示 ① 全局系统 SOP ② 自己的私人 SOP；创建表单里 admin 看到作用域下拉，非 admin 隐藏（后端自动降级 mine）。

`GET /api/sops` 返回结构：

```json
{
  "items": [...SOP...],
  "_meta": { "is_admin": true, "me": { "id": 1, "account": "admin", "name": "林晨" } }
}
```

---

## 8. 数据模型

### 核心表

#### sops（SOP 规则）

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| name | TEXT | SOP 名称 |
| trigger_type | TEXT | 见 §5.1 枚举 |
| trigger_days | INTEGER | 沉睡天数阈值 |
| trigger_min_spend | REAL | 最低消费阈值 |
| trigger_channel | TEXT | 可选，渠道限定 |
| steps | TEXT (JSON) | 动作数组 |
| conditions | TEXT (JSON, nullable) | 自定义筛选条件树 |
| run_count | INTEGER | 累计执行客户数 |
| conversion | REAL | 转化率 |
| active | INTEGER (0/1) | 是否激活 |
| mode | TEXT | retail / service |
| scope | TEXT | all / mine |
| created_by | INTEGER (nullable) | 创建者 users.id |
| is_template | INTEGER (0/1) | 系统模板 |
| created_at | TEXT | ISO 时间 |

#### customers（客户）

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| name | TEXT | |
| wecom_external_userid | TEXT | 企微外部联系人 userid |
| wecom_chat_id | TEXT | 关联的企微群 |
| staff_id | INTEGER (nullable) | 归属顾问 staff.id |
| stage | TEXT | new / mature / churn / vip |
| spend | REAL | 累计消费 |
| orders | INTEGER | 订单数 |
| channel | TEXT | 来源渠道 |
| last_active | TEXT | ISO 时间 |
| created_at | TEXT | |

#### follow_ups（跟进记录）

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| customer_id | INTEGER FK | |
| staff_id | INTEGER FK (nullable) | |
| type | TEXT | sop_phone_call / sop_gift_send / 手工跟进 |
| content | TEXT | 跟进内容 |
| outcome | TEXT | 待处理 / 自动执行:已发送 / 降级未发:... |
| created_at | TEXT | |
| resolved_at | TEXT (nullable) | |

#### wecom_events（企微事件审计）

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | |
| event_type | TEXT | send_wechat / send_internal_msg / invite_group / sop_step_intent |
| change_type | TEXT | sent / simulated |
| payload | TEXT (JSON) | 完整请求体 |
| created_at | TEXT | |

#### 其他表

`orders`, `staff`, `users`, `tags`, `coupons`, `broadcasts`, `groups`, `seas`, `seckill`, `sop_runs`, `intent_logs`, `wecom_config`, `msg_audit_state`, `chat_messages`, `api_tokens`。

### schema 迁移

所有列加删通过 `db.js` 的 `initSchema()` 统一管理——启动时遍历 `COLUMNS_TO_ENSURE`，用 `ALTER TABLE ... ADD COLUMN ... IF NOT EXISTS` 保证幂等。首次启动自动建表。

---

## 9. 权限模型

### 鉴权方式

| 方式 | 场景 | 字段 |
|------|------|------|
| **JWT** | 企微侧边栏登录 / 账号密码登录 | `Authorization: Bearer <jwt>` |
| **API Token** | 第三方集成 / 脚本调用 | `Authorization: Bearer neb_<hash>` |

middleware 在 `server/src/middleware/`：`auth.js`（JWT + API Token 二选一）、`apiToken.js`（Token 生成/校验）。

### 角色判定（后端强约束）

| 判定 | 实现 | 效果 |
|------|------|------|
| **admin** | `users.account === 'admin'` | 可建 scope=all SOP，可编辑/删除任何 SOP |
| **staff 归属** | `deriveStaffId(req.user)` → users.wecom_userid → staff.wecom_userid | 用于 scope=mine 过滤 + 企微通知定向 |
| **模板只读** | `row.is_template = 1` | PUT / DELETE / run 都拒绝 |

**不信任前端传参**：scope / staffId / created_by 都从 req.user 后端派生，前端传错会被覆盖。

---

## 10. API 路由清单

基地址 `http://localhost:3001`（全部需 Authorization 头，除 /public /openapi 外）。

### 核心路由

| Method | Path | 文件 | 说明 |
|--------|------|------|------|
| POST | `/auth/login` | auth.js | 账号密码登录 → token |
| POST | `/auth/wxlogin` | auth.js | 企微侧边栏 code 登录 |
| GET | `/api/dashboard/summary` | dashboard.js | Dashboard 指标汇总 |
| GET | `/api/customers` | customers.js | 客户列表（分页 + 筛选） |
| POST | `/api/customers/:id/tags` | customers.js | 批量打标签 |
| GET | `/api/sops` | sops.js | SOP 列表 + `_meta` |
| POST | `/api/sops` | sops.js | 新建 SOP（scope 后端校验） |
| PUT | `/api/sops/:id` | sops.js | 编辑（scope 层级权限） |
| DELETE | `/api/sops/:id` | sops.js | 删除 |
| POST | `/api/sops/:id/clone` | sops.js | 克隆 |
| POST | `/api/sops/:id/run` | sops.js | 手动触发执行 |
| GET | `/api/sops/:id/customers` | sops.js | 预估覆盖客户预览 |
| GET | `/api/sops/runs/all` | sops.js | SOP 运行历史 |
| GET | `/api/follow-ups` | followups.js | 待办跟进列表（TYPE_FILTER） |
| PUT | `/api/follow-ups/:id/complete` | followups.js | 标记完成 |
| POST | `/api/broadcasts` | broadcasts.js | 创建群发计划 |
| POST | `/api/broadcasts/:id/send` | broadcasts.js | 触发短信群发 |
| GET | `/api/staff` | staff.js | 顾问列表 |
| GET | `/api/groups` | groups.js | 企微群列表 |
| GET | `/api/coupons` | coupons.js | 优惠券列表 |
| POST | `/api/tags` | tags.js | 创建标签 |
| GET | `/api/wecom/config` | wecom.js | 企微配置读写 |
| POST | `/api/msgaudit/poll` | msgaudit.js | 手动触发会话存档轮询 |
| GET | `/api/segments/preview` | segments.js | 客群预览（AND/OR 条件） |
| POST | `/api/qrcodes` | qrcodes.js | 创建渠道码 |

---

## 11. 定时调度器

`server/src/scheduler.js` 在后端启动后立即运行 4 个递归定时器（`setTimeout` 而非 `setInterval`，避免回调堆积）：

| 定时器 | 周期 | 行为 |
|--------|------|------|
| 会话存档轮询 | 5 min | 调企微 MSGAudit 拉最新 7 天聊天，写 chat_messages，触发自动打标 |
| 每日归零 | 每天 00:01 | 重置 SOP 今日触发计数器 |
| SOP 日触达 | 每天 09:00 | 对所有激活的 `scope=all` days_inactive SOP 执行一次全量匹配（跳过 scope=mine） |
| 每日日报 | 每天 08:00 | 生成昨日经营数据日报，推送企微内部群 |

手动触发接口：`POST /api/msgaudit/poll` / `POST /api/daily-report/generate`。

---

## 12. 业务模式（retail / service）

系统通过 `business_mode` 区分 C 端零售和 B 端企服：

| 维度 | retail | service |
|------|--------|---------|
| 默认 SOP 模板 | 沉睡唤醒 / 售后关怀 / 退群挽回 | MQL 推进 / 招投标 / 沙龙激活 / CSM 续约 |
| 客户 stage 重点 | new → mature → vip | lead → mql → sql → customer |
| Dashboard 指标 | 复购率、客单价、沉睡客户数 | 商机转化率、签单周期、续约率 |

前端顶部有业务模式切换，后端所有列表接口都按 `?mode=retail|service` 过滤，默认 retail。

---

## 13. 目录结构

```
/workspace
├── docs/                      # 系统说明文档
│   └── SYSTEM.md              # ← 本文件
├── server/                    # Node.js 后端
│   ├── data/
│   │   └── scrm.db            # SQLite 数据库（WAL 模式，.db-wal/.db-shm 已 gitignore）
│   ├── src/
│   │   ├── index.js           # Express 入口
│   │   ├── db.js              # better-sqlite3 + initSchema 迁移
│   │   ├── scheduler.js       # 4 个递归定时器
│   │   ├── wecom.js           # 企微 API 封装
│   │   ├── middleware/
│   │   │   ├── auth.js        # JWT + API Token 二选一
│   │   │   └── apiToken.js    # Token 生成/校验
│   │   ├── routes/            # 24 个 REST 路由模块
│   │   │   ├── sops.js
│   │   │   ├── dashboard.js
│   │   │   ├── followups.js
│   │   │   ├── customers.js
│   │   │   ├── broadcasts.js
│   │   │   ├── wecom.js
│   │   │   ├── msgaudit.js
│   │   │   ├── auth.js
│   │   │   └── ...
│   │   └── utils/
│   │       ├── sop-engine.js  # SOP 分层执行核心
│   │       ├── events.js      # 事件驱动 SOP 匹配
│   │       ├── daily-report.js
│   │       └── ...
│   ├── seed.js                # 种子数据
│   └── package.json
├── client/                    # React + Vite 前端
│   ├── src/
│   │   ├── App.tsx            # 主布局 + 路由
│   │   ├── api.ts             # 全部 API 封装
│   │   ├── types.ts           # 共享类型定义
│   │   ├── views/
│   │   │   ├── DashboardView.tsx
│   │   │   ├── SopView.tsx
│   │   │   ├── CustomersView.tsx
│   │   │   ├── BroadcastView.tsx
│   │   │   └── ...
│   │   └── components/
│   └── package.json
├── .gitignore
└── scrm_private_domain_management.html  # 企微私域经营说明（静态文档）
```

---

## 附：最近一次 push 摘要

```
commit  735d2d6  feat: SOP 分层执行（自动 vs 人工）+ scope 作用域（全局系统 vs 私人顾问）
push    main -> origin/main  (e706fd8..735d2d6)
15 files changed, +869 / -274
```

### 核心改动

- **SOP 分层执行**：自动类 action（send_wechat / invite_group 等）调企微 API，降级不阻塞，不进 Dashboard 待办；人工类（phone_call / gift_send）才写 outcome=待处理 + 内部企微通知
- **SOP scope 作用域**：scope=all 系统级（仅 admin 可建，scheduler/events 自动执行）；scope=mine 私人级（后端强制 staff_id 过滤，仅手动 run）
- **Dashboard TYPE_FILTER**：只暴露 sop_phone_call / sop_gift_send / 非 SOP 手工跟进，自动类污染=0
- **前端 SopView**：scope 标签、admin 可见作用域下拉、列表软过滤、模板接口格式修复
- **模板 tab bug 修复**：`getSopTemplates` 同步新版 `{ items, _meta }` 响应格式，否则 `.filter()` 报错被 catch 吞掉
- **gitignore 补齐**：从 git 移除 scrm.db-wal / scrm.db-shm（SQLite WAL 垃圾文件）
