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
  - [5.6 标签 / 优惠券 / 活码 / 秒杀](#56-标签--优惠券--活码--秒杀)
- [6. SOP 分层执行机制](#6-sop-分层执行机制)
- [7. SOP Scope 作用域机制](#7-sop-scope-作用域机制)
- [8. 数据模型](#8-数据模型)
- [9. 权限模型](#9-权限模型)
- [10. API 路由清单](#10-api-路由清单)
  - [核心路由](#核心路由)
  - [公开路由（无鉴权）](#公开路由apipublic无鉴权)
- [11. 定时调度器](#11-定时调度器)
- [12. 业务模式（retail / service）](#12-业务模式retail--service)
- [13. 目录结构](#13-目录结构)
- [附 A：版本历史（Changelog）](#附-a版本历史changelog)
- [附 B：IDE 预览容器部署指南](#附-bide-预览容器部署指南)

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
| **活码生成** | **qrcode（PNG 按需生成，公开访问）** | **^1.5** |
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

- **后端**：单进程 Node.js，默认端口 3001，SQLite 内嵌，零外部依赖。也可以直接跑 `PORT=5173`（IDE 预览容器默认端口），Express 同时 `express.static` 前端 build 产物
- **前端**：`npm run build` 产物由 Express 托管（`/` 路由 SPA fallback），开发模式 `npm run dev`（5173）带 HMR
- **数据库**：`server/data/scrm.db`（WAL 模式，-wal / -shm 文件 gitignore）
- **公开端点**：`/api/public/*`（活码 PNG、落地页 URL、领券、秒杀抢单），无鉴权，用于 C 端客户扫码直接访问

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

**默认端口**：后端 3001，前端 dev 5173。生产模式推荐：前端 build 后全部走后端单端口（`PORT=5173 node src/index.js`）。

> **IDE 预览容器**：agent-tool-host 只认 5173 端口，Express 必须跑 5173 才能被 IDE 预览面板正常代理到。

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

### 5.6 标签 / 优惠券 / 活码 / 秒杀

| 模块 | 功能 |
|------|------|
| **Tags** | 客户打标签 / 移除标签，支持批量操作，SOP 条件构建器动态下拉 |
| **Coupons** | 优惠券创建 + 发放 + 核销，支持限制适用范围 |
| **Seckill** | 限时秒杀活动，库存管理 + 模拟抢单 + 订单占位 |
| **QRCodes（活码）** | 渠道码 / 活码，**三种 CTA 模式**（见下方），公开 PNG 下载，落地页领券 |
| **Groups** | 企微群管理，关联 wecom_external_userid，SOP 可 invite_group |

#### 活码 CTA 三种模式（`cta_type` 字段）

| 模式 | 枚举 | 扫码行为 | 适用场景 |
|------|------|----------|----------|
| **hybrid（默认 ⭐）** | `hybrid` | H5 落地页领券 → 底部显示「专属顾问 XXX」信任卡 | 活动获客 + 顾问转化，路径最顺 |
| **add_staff** | `add_staff` | 直接跳企微加好友（官方活码 ticket） | 纯拉好友（线下名片） |
| **target_page** | `target_page` | 纯 H5 落地页领券，不显示顾问 | 老行为兼容，纯活动触达 |

**降级机制**：选了 `add_staff` 但企微凭据未连通 → 自动降级为 `hybrid`，`landing-url` 返回里带 `degraded: true`。

#### 活码公开端点（无鉴权）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/public/qrcodes/:id/png?size=360` | 按需生成 360×360 PNG（默认），Cache-Control 1h |
| GET | `/api/public/qrcodes/:id/landing-url` | 返回 `{ landing_url, target_type, target_id, cta_type, degraded }` |
| GET | `/api/public/qrcodes/:id/staff` | 活码绑定的顾问信息（头像、姓名、工号） |
| GET | `/api/public/coupons/:id` | 券公开预览（面值、名称、进度） |

**落地页路由**：`/p/coupon?qr=<id>`（领券）/ `/p/seckill?qr=<id>`（秒杀），由 Express SPA fallback → React Router 接管。

#### 落地页设计亮点

`PublicCouponView.tsx` 采用衬线字体 + 多层柔光背景 + 券面值大字 Hero + 折角效果 + 顾问信任卡 + 涟漪 CTA 按钮。顾问卡头像用首字母 + 在线标识（绿色圆点），CTA 按钮点击时有金色涟漪高光动画。

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

### 公开路由（`/api/public/*`，无鉴权）

| Method | Path | 文件 | 说明 |
|--------|------|------|------|
| POST | `/api/public/scan` | public.js | 活码扫码建档（首扫触发，客户自动建档 + 打标签） |
| POST | `/api/public/coupons/claim` | public.js | C 端客户领券（公开） |
| POST | `/api/public/seckill/:id/grab` | public.js | C 端秒杀抢单 |
| GET | `/api/public/customer/:code/coupons` | public.js | 客户"我的券包"（通过唯一 code 识别） |
| GET | `/api/public/qrcodes/:id/landing-url` | public.js | 返回活码落地页 URL + CTA 类型 + 降级状态 |
| GET | `/api/public/qrcodes/:id/png?size=360` | public.js | 按需生成 PNG 活码图（qrcode 库），Cache-Control 1h |
| GET | `/api/public/qrcodes/:id/staff` | public.js | 活码绑定的顾问信息（首字母头像 + 姓名 + 工号） |
| GET | `/api/public/coupons/:id` | public.js | 券公开预览（面值、名称、已领进度） |
| GET | `/api/public/seckill/:id` | public.js | 秒杀活动公开预览（库存、价格、倒计时） |

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
│   │   ├── index.js           # Express 入口（托管前端静态 + API 路由）
│   │   ├── db.js              # better-sqlite3 + initSchema 迁移
│   │   ├── scheduler.js       # 4 个递归定时器（会话存档 / 归零 / SOP 日触达 / 日报）
│   │   ├── wecom.js           # 企微 API 封装（access_token 缓存 + 降级）
│   │   ├── middleware/
│   │   │   ├── auth.js        # JWT + API Token 二选一
│   │   │   └── apiToken.js    # Token 生成/校验
│   │   ├── routes/            # 24 个 REST 路由模块
│   │   │   ├── auth.js
│   │   │   ├── sops.js        # SOP CRUD + 手动 run + scope 后端校验
│   │   │   ├── dashboard.js   # Dashboard 指标汇总
│   │   │   ├── customers.js   # 客户 CRUD + 标签批量操作
│   │   │   ├── broadcasts.js  # 短信群发
│   │   │   ├── qrcodes.js     # 活码管理（CRUD，cta_type 字段）
│   │   │   ├── public.js      # ★ 公开端点（活码 PNG / 落地页 / 领券 / 秒杀，无鉴权）
│   │   │   ├── coupons.js     # 优惠券管理
│   │   │   ├── seckill.js     # 限时秒杀活动
│   │   │   ├── wecom.js       # 企微配置
│   │   │   ├── msgaudit.js    # 会话存档
│   │   │   ├── orders.js      # 订单
│   │   │   ├── followups.js   # 跟进记录 + 待办
│   │   │   ├── groups.js      # 企微群
│   │   │   ├── segments.js   # 客群分群 + AND/OR 条件预览
│   │   │   ├── seas.js        # 线索公海
│   │   │   ├── staff.js       # 顾问列表
│   │   │   ├── tags.js        # 标签
│   │   │   ├── reports.js     # 报表
│   │   │   ├── backup.js      # 数据库备份（每日 3 点 VACUUM + 7 天保留）
│   │   │   ├── openapi.js     # 第三方集成 API
│   │   │   └── ext.js         # 外部系统对接（/api/ext/*，微商城/POS 用 X-API-Key 鉴权）
│   │   └── utils/
│   │       ├── sop-engine.js  # SOP 分层执行核心（自动 vs 人工）
│   │       ├── events.js      # 事件驱动 SOP 匹配
│   │       ├── daily-report.js
│   │       └── wecom-crypto.js# 企微加解密
│   ├── seed.js                # 种子数据
│   └── package.json           # 依赖含 better-sqlite3 / express / qrcode ^1.5
├── client/                    # React + Vite 前端
│   ├── src/
│   │   ├── App.tsx            # 管理后台主布局 + 路由
│   │   ├── PublicApp.tsx      # ★ C 端公开落地页路由（/p/coupon /p/seckill）
│   │   ├── api.ts             # 全部 API 封装（含公开端点）
│   │   ├── types.ts           # 共享类型定义（含 QrCode.cta_type）
│   │   ├── views/             # 管理后台 15 个视图 + 4 个 C 端落地页
│   │   │   ├── DashboardView.tsx    # 运营监控仪表盘（指标卡 + 销售漏斗 + 今日待办）
│   │   │   ├── SopView.tsx          # SOP 自动化策略流 + 条件构建器
│   │   │   ├── CustomersView.tsx    # 客户列表 + 标签批量 + 客户抽屉
│   │   │   ├── FollowUpsView.tsx    # 跟进记录 + 待办列表（phone_call / gift_send）
│   │   │   ├── QrCodeView.tsx       # 活码管理（CTA 三种模式 + PNG 下载预览）
│   │   │   ├── CouponView.tsx        # 优惠券 + 发券
│   │   │   ├── SeckillView.tsx       # 秒杀活动 + 模拟抢单
│   │   │   ├── BroadcastView.tsx     # 精准触达 / 群发
│   │   │   ├── SegmentsView.tsx      # 客户分群（AND/OR 条件预览）
│   │   │   ├── GroupsView.tsx        # 企微群管理
│   │   │   ├── StaffView.tsx         # 顾问列表 + 业绩
│   │   │   ├── TagLibraryView.tsx    # 标签库管理
│   │   │   ├── SeasView.tsx          # 线索公海
│   │   │   ├── WecomView.tsx         # 企微对接中心（配置 + 会话存档 + 视频号订单）
│   │   │   ├── AuthView.tsx          # 登录页
│   │   │   └── public/           # ★ C 端公开落地页（Express SPA fallback → React Router）
│   │   │       ├── PublicCouponView.tsx   # 领券页（衬线字体 + 券面值 Hero + 顾问信任卡 + 涟漪 CTA）
│   │   │       ├── PublicSeckillView.tsx  # 秒杀抢单页（库存 + 倒计时 + 进度条）
│   │   │       ├── PublicShopView.tsx     # 商城页（商品列表 + 入口导航）
│   │   │       ├── PublicMyCouponsView.tsx # 我的券包（通过唯一 code 识别客户）
│   │   │       └── shared/
│   │   │           └── StaffTrustCard.tsx # 顾问信任卡（hybrid 模式落地页展示）
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   │   ├── Modal.tsx
│   │   │   │   ├── Drawer.tsx
│   │   │   │   ├── Toast.tsx
│   │   │   │   ├── Avatar.tsx           # 首字母头像（顾问 / 客户卡片）
│   │   │   │   ├── Empty.tsx            # 空状态占位
│   │   │   │   └── DialogProvider.tsx   # ★ React 版 confirm/prompt/alert（sandbox iframe 原生弹窗替代）
│   │   │   ├── layout/                  # 侧边栏（14 模块导航，见下）+ 顶部 Header
│   │   │   ├── customers/               # 客户抽屉 + 标签管理 Modal
│   │   │   └── sop/                     # SOP 条件构建器（AND/OR 嵌套）
│   │   ├── utils/
│   │   │   ├── dialog.ts                # ★ 覆盖 window.confirm/prompt/alert 为 Promise 版本（启动时挂载）
│   │   │   └── avatar.ts                # 首字母头像生成
│   │   └── index.css                    # Tailwind + public 主题（柔光背景 + 金色渐变 + 涟漪动画 + 入场动效）
│   └── package.json            # 依赖含 react 18 / vite 6 / tailwind 3 / chart.js
├── .gitignore
└── scrm_private_domain_management.html  # 企微私域经营说明（静态文档）
```

### 侧边栏 14 模块导航（Sidebar.tsx `NAV_ITEMS`）

| 模块 | ID | 图标 | 功能 |
|------|----|------|------|
| 运营监控仪表盘 | dashboard | chart-pie | 指标卡 + 销售漏斗 + 今日待办 + SOP 运行历史 |
| 客户资产 360° | customers | user-tag | 客户列表 + 筛选 + 标签批量 + 客户详情抽屉 |
| 今日待跟进 | followups | list-check | phone_call / gift_send 人工待办 |
| 线索公海 | seas | water | 未分配客户池，员工自行认领 |
| 渠道活码 | qrcodes | qrcode | 活码管理 + CTA 三种模式 + PNG 下载预览 |
| 客户分群管理 | segments | layer-group | AND/OR 条件预览，给群发/SOP 用 |
| 企微社群矩阵运营 | groups | comments | 企微群列表 + 关联成员 |
| SOP 自动化策略流 | sop | bolt-lightning | SOP CRUD + scope 作用域 + 手动 run + 条件构建器 |
| 优惠券与发券中心 | coupons | tags | 券创建 + 发放 + 核销 |
| 限时秒杀与福利抢单 | seckill | bolt | 秒杀活动 + 库存 + 模拟抢单 |
| 精准触达与群发 | broadcast | bullhorn | 群发计划创建 + 短信下发 |
| 企微对接中心 | wecom | plug | corp_id/corp_secret 配置 + 会话存档 + 视频号订单 |
| 员工管理 | staff | users-gear | 顾问列表 + 归属客户 + 业绩 |
| 标签库管理 | tags | tags | 标签 CRUD + 客户批量打标 |

---

## 附 A：版本历史（Changelog）

### v2.2 — 2026-10-09：活码 CTA 三种模式 + 落地页重设计 + sandbox 兼容

**核心主题**：活码链路打通（企微官方活码 ↔ H5 落地页 ↔ 顾问卡片），IDE 预览容器 sandboxed iframe 兼容

| 改动 | 说明 |
|------|------|
| **活码 CTA 三种模式** | `hybrid`（默认，落地页+顾问卡）/ `add_staff`（直接加顾问）/ `target_page`（纯落地页），`db.js` 新增 `qr_codes.cta_type` 列 |
| **活码公开 PNG 下载** | `GET /api/public/qrcodes/:id/png` — qrcode 库按需生成，Cache-Control 1h，公开无鉴权 |
| **活码落地页 URL API** | `GET /api/public/qrcodes/:id/landing-url` — 返回 `{ landing_url, target_type, cta_type, degraded }` |
| **add_staff 自动降级** | 企微凭据缺失时自动降级为 hybrid，前端透明感知 |
| **落地页重设计** | `PublicCouponView.tsx` — 衬线字体 + 多层柔光背景 + 券面值大字 Hero + 折角效果 + 涟漪 CTA 按钮 + 顾问信任卡 |
| **顾问卡片** | `hybrid` 模式在落地页表单下方和领取成功页展示顾问头像（首字母）+ 姓名 + 在线标识 |
| **公开端点路由** | `public.js` — scan 扫码建档 / coupons/claim 领券 / seckill/:id/grab 秒杀抢单 / qrcodes PNG/landing-url/staff / coupons/:id / seckill/:id |
| **DialogProvider** | React 版 confirm/prompt/alert 三件套，Promise 接口，挂载时覆盖 `window.confirm/prompt/alert` |
| **sandbox 兼容** | IDE 预览容器为 sandboxed iframe，原生 prompt() 直接抛 `prompt() is not supported`，13 处原生弹窗全部替换为 `await window.confirm/prompt` |
| **Express 单端口模式** | `PORT=5173 node src/index.js` — 同时 serve 前端 build 静态 + API，agent-tool-host 只认 5173 |

**涉及文件**（新增 + 修改）：
- 后端：`public.js`（新建，9 个公开路由）、`db.js`（qr_codes 加 cta_type/target_type/target_id 列）、`qrcodes.js`（CRUD 读写 cta_type，切换 add_staff 时清旧 ticket）、`index.js`（路由顺序调整 + SPA fallback）、`package.json`（+qrcode ^1.5.4 依赖）、`public.js`（landing-url 动态构建 + x-forwarded-host 识别 + buildLandingUrl 函数）
- 前端组件：`DialogProvider.tsx`（新建，React 版 confirm/prompt/alert Modal）、`dialog.ts`（新建，window 全局覆盖）、`Avatar.tsx`、`Drawer.tsx`、`Empty.tsx`（补齐 ui 三件套）
- 前端视图：`PublicCouponView.tsx`（全量重写 356 行，衬线字体 + 券面值 Hero + 折角效果 + 顾问信任卡 StaffTrustCard + 涟漪 CTA）、`QrCodeView.tsx`（新建/下载按钮 + 三选一 CTA 卡片 + 预览 Modal）、10 个视图文件（13 处原生 prompt/confirm 替换为 `await window.confirm/prompt`）
- 前端全局：`App.tsx`（根节点包 DialogProvider）、`index.css`（+150 行 public 主题：柔光背景、金色渐变、漂移动画、涟漪 CTA、入场动效）、`types.ts`（QrCode 加 cta_type/target_type/target_id）、`api.ts`（createQrCode/updateQrCode 参数补 cta_type）、`vite.config.ts`（dev/preview 加 host: '0.0.0.0'）

---

### v2.1 — 2026-09-24：SOP 分层执行 + scope 作用域

**核心主题**：自动执行 vs 人工待办分离，系统级 vs 私人级 SOP 隔离

| 改动 | 说明 |
|------|------|
| SOP 分层执行 | 自动类 action 调企微 API（send_wechat/invite_group 等），降级不阻塞，不进 Dashboard 待办；人工类（phone_call/gift_send）写 outcome=待处理 + 内部企微通知 |
| SOP scope | scope=all（仅 admin 可建，scheduler/events 自动执行）vs scope=mine（后端强制 staff_id 过滤，仅手动 run） |
| Dashboard TYPE_FILTER | 只暴露 sop_phone_call / sop_gift_send / 非 SOP 手工跟进，自动类污染=0 |
| db.js 迁移 | sops 表新增 scope + created_by 两列 |

---

### v2.0 — 2026-09 初：MVP 启动

首个可运行版本 — SQLite + Express + React + Tailwind，包含客户管理 / SOP 基础 / Dashboard / 标签 / 优惠券 / 企微对接 / 会话存档轮询 / 定时调度器。

---

## 附 C：生产级部署 Checklist

本系统在 v2.2 发布时已完成一轮生产安全加固，以下是上线前必须检查的项目。

### 1. 环境变量硬约束（server/.env.example 已提供）

| 变量 | 生产必须设？ | 默认值 | 说明 |
|------|-------------|--------|------|
| `NODE_ENV` | ✅ 必须 | dev | 决定 CORS 策略、日志级别、uncaughtException 行为 |
| `JWT_SECRET` | ✅ 必须（改随机串） | dev 默认内置值 | 泄露则任何人能伪造 admin token |
| `CORS_ORIGIN` | ✅ 必须（白名单） | prod=false（禁跨域）| 多个域名逗号分隔；内网部署设 `false` 即可 |
| `PORT` | 可选 | 3001 | 负载均衡走哪个端口 |
| `WECOM_CORP_ID` + `WECOM_CORP_SECRET` | 企微对接时必须 | 未配置=simulated 模式 | simulated 模式所有企微 API 跳过不真正调用 |

### 2. 已完成的生产加固（v2.2 上线时）

| 加固项 | 代码位置 | 之前状态 | 现在 |
|--------|----------|----------|------|
| **进程级异常守护** | `index.js` L37-50 | ❌ 无 handler，uncaughtException 直接 crash | ✅ unhandledRejection 兜住 + uncaughtException 开发继续跑 / 生产优雅 exit |
| **Express 4 async error 穿透** | `utils/wrap.js` + 8 个路由文件的 12 个 handler | ❌ async 路由 throw → 进程 crash，全局 error handler 收不到 | ✅ wrapAsync 包一层 `.catch(next)`，所有 async handler 的 throw 都能到 error handler |
| **CORS 默认全开放** | `index.js` L56-68 | ❌ `cors({ origin: '*' })` | ✅ prod 默认禁跨域，dev 只放 localhost，生产必须显式配置白名单 |
| **路由全局错误 handler** | `index.js` L177-195 | ✅ 已存在 | ✅ 处理 SQLITE_CONSTRAINT / SQLITE_BUSY / requestId 回传 |
| **请求访问日志** | `index.js` L54-56 | ✅ 已存在（morgan combined/dev）| ✅ /api/health 跳过 |
| **登录防暴力** | `index.js` L59-66 | ✅ 已存在（30 次 / 15 分钟）| ✅ |
| **Webhook 防刷** | `index.js` L69-71 | ✅ 已存在（60 次/分钟）| ✅ |
| **Scheduler 递归守护** | `scheduler.js` | ✅ 每个 setTimeout 回调包 try-catch | ✅ 永不静默断链 |
| **自动定时备份** | `scheduler.js` + `routes/backup.js` | ✅ 每日 3 点 VACUUM + 保留 7 天 | ✅ data/backups 目录 |
| **健康检查端点** | `index.js` L83-105 | ✅ 已存在 | ✅ 返回 wecom 状态、客户数、员工数、pending broadcasts |
| **请求 ID 追踪** | `index.js` L46-50 | ✅ 已存在（X-Request-Id 头）| ✅ 贯穿 morgan + error handler + 客户端可查 |

### 3. 上线前验证命令

```bash
# 1. env 合规检查（至少非 dev）
cat server/.env | grep NODE_ENV  # 应该不是 dev

# 2. 启动命令
cd server && NODE_ENV=prod PORT=3001 \
  JWT_SECRET=$(openssl rand -hex 32) \
  CORS_ORIGIN="https://your-scrm.your-company.com" \
  node src/index.js

# 3. 健康检查
curl http://localhost:3001/api/health
# 期望: {"ok": true, "app": "nebula-scrm", ...}

# 4. CORS 拒绝验证（用不匹配的 origin 试跨域请求）
curl -H "Origin: https://evil.com" http://localhost:3001/api/public/qrcodes/4/landing-url -I
# 期望: Access-Control-Allow-Origin 不包含 evil.com

# 5. 前端 build
cd client && npm run build
# 产物直接由 Express serve（单进程一体化）
```

### 4. 还可以继续优化的方向（非 blocker）

| 方向 | 优先级 | 说明 |
|------|--------|------|
| API 版本管理 | P2 | 目前路由无 `/v1/` 前缀，未来改字段会破坏兼容性 |
| 前端首屏 chunk split | P2 | 616KB 单 chunk，可把 chart.js / 管理后台 / 落地页拆成独立 chunk |
| rate-limit 扩展到写路由 | P2 | 目前只盖登录 + webhook，可加 `/api/customers` 的 POST rate limit |
| Zod 输入校验全覆盖 | P2 | 目前部分路由有，零 try-catch 的 8 个路由（backup/coupons/seckill 等）可补 |
| 结构化日志（pino） | P3 | 目前 log() 是 console 包装，生产可换 JSON 格式方便 ELK |
| 定时任务可观测性 | P3 | 加 `/api/health/scheduler` 返回每个定时器上次触发时间 + 是否连续成功 |
| 备份完整性自动校验 | P3 | 备份后跑 `PRAGMA integrity_check`，失败则告警 |

---

## 附 B：IDE 预览容器部署指南

IDE 预览面板走 K8s 容器 + agent-tool-host 代理层，有三个硬约束：

| 约束 | 解决方案 |
|------|----------|
| **只认 5173 端口** | Express 直接 `PORT=5173 node src/index.js`，不跑 3001 |
| **sandboxed iframe 禁止原生弹窗** | 必须挂载 DialogProvider，覆盖 window.confirm/prompt/alert |
| **Express 必须 serve 前端静态** | `index.js` 中 `express.static(client/dist)` + SPA fallback（`if (!/^\/api/.test(req.path)) sendFile index.html`） |

**一条命令启动**：
```bash
cd /workspace/client && npm run build
cd /workspace/server && PORT=5173 node src/index.js
```

**预览面板地址格式**（IDE 自动生成）：
```
https://run-agent-xxx-preview.agent-sandbox-bj-d1-gw.traecontent.cn/?_port=5173
```
