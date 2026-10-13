# 移除 BizMode 硬编码，SCRM 底座通用化改造

## 背景与问题

当前系统在登录时强制选择 `retail`（C 端零售）或 `service`（B 端企服）两种 BizMode，后续前端展示换皮、SOP 模板库、标签/分群/活码/公海线索的后端 API 全部按 mode 过滤。

**问题**：demo 阶段不确定客户所属行业，甚至一个客户可能同时经营 B 端和 C 端业务。把 mode 硬编码进数据模型会阻碍客户使用，并导致未来必须再做一次迁移。

**目标**：去掉 BizMode 的强制分流，系统变成一个通用的 SCRM 底座，SOP 模板同时内置零售和企服两套供选择，其余模块不过滤行业。

---

## 改动范围总览

### 前端（22 个文件）
| 类别 | 文件 | 改动 |
|------|------|------|
| 核心类型 | `types.ts` | `MODE_META` 合并为中性配置；`BizMode` 保留但不再作为必填过滤条件 |
| 路由入口 | `App.tsx` | 去掉 `mode` state、侧边栏 mode 切换；登录用户不再依赖 mode |
| 布局 | `Sidebar.tsx`, `Header.tsx` | 去掉 mode 切换按钮、mode 相关展示 |
| 登录 | `AuthView.tsx` | 去掉"选择业务模式"步骤，直接登录/注册 |
| API 层 | `api.ts` | 去掉请求里的 `mode` query 参数（`getCustomers` 保留 customer_type 过滤） |
| 视图（13 个） | `DashboardView`, `CustomersView`, `SegmentsView`, `SopView`, `BroadcastView`, `GroupsView`, `SeasView`, `QrCodeView`, `CouponView`, `SeckillView`, `TagLibraryView`, `StaffView`, `WecomView`, `FollowUpsView`, `CustomerDrawer`, `CustomerFormModal`, `TagManageModal` | 去掉 `MODE_META[mode]` 分支；去掉 API 调用里传的 mode 参数；SOP 视图加载全部模板不再按 mode 过滤 |

### 后端（19 个文件）
| 类别 | 文件 | 改动 |
|------|------|------|
| 入口 | `index.js` | 去掉 channel 查询里的 `customer_type` 过滤 |
| 认证 | `routes/auth.js` | 去掉 `businessMode` 必填校验，注册/登录不再依赖 mode |
| SOP 核心 | `routes/sops.js`, `utils/sop-engine.js` | SOP 不再强制按 mode 过滤；模板库一次性返回全部行业模板；`sop-engine` 写入 tags 时去掉 mode 参数 |
| 数据路由（7 个） | `routes/segments.js`, `routes/qrcodes.js`, `routes/seas.js`, `routes/groups.js`, `routes/tags.js`, `routes/dashboard.js`, `routes/broadcasts.js` | 去掉 `req.query.mode` 过滤条件，返回全部数据 |
| 种子 | `seed.js` | 保留两套种子数据（retail + service）但全部注入，不再按 mode 区分 |
| 其他 | `routes/customers.js`, `routes/coupons.js`, `routes/public.js`, `routes/wecom.js`, `routes/backup.js`, `mcp-tools.js`, `wecom.js` | 逐一排查，去掉 mode 硬编码 |

### 数据库（soft migration）
- **不删列**：`users.business_mode`、`sops.mode`、`tags.mode`、`qr_codes.mode` 等列暂时保留（兼容已存在的数据，避免 sqlite ALTER 风险）
- **只改 WHERE**：路由层不再 `WHERE mode = ?`，返回全部
- **seed.js 重刷**：两种模式的种子数据同时注入，演示时全部可见

---

## 实现步骤（按依赖顺序）

### Phase 1：后端解耦（先改后端，前端暂时兼容，不阻塞）
1. `routes/auth.js` — 注册不再强制 business_mode，默认 null 或 'general'；登录不再读 businessMode 作为分流依据
2. `routes/sops.js` — GET / 去掉 mode 必填过滤；POST / 去掉 mode 强校验
3. `utils/sop-engine.js` — 写入 tags 时去掉 mode 参数
4. 7 个数据路由批量改：segments, qrcodes, seas, groups, tags, dashboard, broadcasts — 去掉 `if (mode === ...) where.push` 逻辑
5. `index.js` — channel 查询去掉 customer_type 过滤
6. `seed.js` — 两套种子数据全部注入，mode 保留 'retail'/'service' 作为 tag-like 标记（兼容列存在）

### Phase 2：前端解耦
7. `AuthView.tsx` — 去掉业务模式选择步骤
8. `Sidebar.tsx`, `Header.tsx` — 去掉 mode 切换按钮和 MODE_META 引用
9. `App.tsx` — 去掉 `mode` state、`onModeChange`、`MODE_META` 引用
10. `types.ts` — MODE_META 合并成一份通用文案（"运营 SCRM 平台" 替代 "B端"/"C端"）；BizMode 类型先保留但逐步去引用
11. `api.ts` — 每个方法去掉传 mode 参数；getCustomers 保留 customer_type 过滤（那是客户属性，不是系统分流）
12. 13 个视图文件逐个清理：`MODE_META[mode].xxx` → 通用文案；API 调用去掉 mode 参数

### Phase 3：清理与验证
13. TypeScript 类型检查全绿
14. `npm run build` 成功
15. Express 热重载 + 浏览器刷新验证核心流程：登录 → 仪表盘 → 客户列表 → SOP → 活码 → 秒杀
16. 种子数据重刷，确认两类模板同时存在

---

## 依赖与注意事项

- **customer_type ≠ BizMode**：客户表里的 `customer_type` 字段（b端/c端客户标签）是客户自身属性，**保留**；只去掉系统级的 BizMode 分流
- **SOP 模板两套并存**：零售首购 SOP + 企服线索培育 SOP 都加载到模板库，运营自己选哪套，不是系统强塞
- **数据库 soft migration**：不删列，只改 WHERE 条件。避免 sqlite 在 ALTER TABLE 时丢失数据
- **SOP 编辑表单里的 mode 下拉**：可以保留为"行业标签"让运营自愿填，但不再强制
- **AuthJWT payload**：businessMode 字段可以先保留在 token 里（兼容旧 token 解析），但不再作为任何前端/后端逻辑的依据

---

## 验证清单

- [ ] `npx tsc --noEmit` 零错误
- [ ] `npm run build` 成功
- [ ] Express 重启后 API 返回全部数据（不分 mode）
- [ ] 登录不选 mode 也能进
- [ ] SOP 模板库同时看到零售 + 企服两套
- [ ] 仪表盘/客户列表/分群/活码/标签全部展示 seed 数据里的全部记录
- [ ] 浏览器强刷 `Ctrl+Shift+R` 无白屏

## 风险与处理

| 风险 | 影响 | 处理 |
|------|------|------|
| 种子数据两套合并后，演示时 C 端/B 端数据混在一起 | demo 观感变差 | seed 里的数据量可控（几十条），不影响 |
| 旧 JWT token 里带 businessMode 字段 | 无影响，解析时忽略即可 | 后端 auth 路由不再引用 token.businessMode |
| 某路由遗漏 mode 过滤 | 该模块数据不完整 | 每个路由改完后用 curl 测一下 `curl localhost:5173/api/tags` 看是否全部返回 |
| 前端某视图遗漏 MODE_META 引用 | 编译失败 tsc 报错 | tsc --noEmit 会报出来，逐个修 |
