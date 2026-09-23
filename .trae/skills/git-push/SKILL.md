---
name: "git-push"
description: "Automatically commits and pushes current workspace changes. Invoke when coding task is complete and verified, or user says 'push / 推送 / 提交代码 / 上传到 git'."
---

# Git Push — 自动提交并推送到远程

## 触发时机

- 任何编码任务完成并通过验证（tsc / smoke test / npm run build）之后
- 用户明确说"推送 / push / 提交代码 / 上传"

## 工作流

```
① 扫描状态 → ② 过滤敏感文件 → ③ 暂存 → ④ 生成规范化 commit message → ⑤ commit → ⑥ push → ⑦ 汇报结果
```

### ① 扫描状态
```bash
git status --short
git branch --show-current
git remote -v | head -2
```

### ② 敏感文件跳过（从暂存区移除，不进 commit）

| 模式 | 说明 |
|------|------|
| `*.db`, `*.sqlite`, `*.sqlite3` | 本地数据库文件 |
| `*.log` | 日志 |
| `*.bak`, `*.orig`, `*.tmp` | 备份/临时 |
| `.trae-html-share-packages/` | Trae 截图/上传缓存 |
| `node_modules/`, `.next/`, `dist/`, `build/` | 依赖/构建产物 |
| `.env*`, `*.pem`, `*.key` | 密钥与环境变量 |
| `.DS_Store`, `Thumbs.db` | 系统垃圾 |

移除命令模板：
```bash
git reset HEAD -- "*.db" "*.sqlite" "*.log" "*.bak" ".trae-html-share-packages/" ".env*" 2>/dev/null
```

### ③ 暂存全部（剩余变更）
```bash
git add -A
```

### ④ 生成 commit message

格式：`<type>: <summary>

<details>`

**type 清单**：
- `feat` — 新功能
- `fix` — bug 修复
- `refactor` — 重构（不改变对外行为）
- `style` — 格式调整（空格、分号等，不影响逻辑）
- `docs` — 纯文档
- `chore` — 构建、依赖、工具链改动
- `perf` — 性能优化
- `test` — 测试相关

summary 控制在 50 字内、用中文（与当前会话语言保持一致）。details 列出关键文件和改动点，每行一个。

### ⑤ commit + ⑥ push
```bash
git commit -m "feat: ..." -m "后端：
- xxx
前端：
- xxx"

# 优先用当前分支；如果远端不存在该分支，用 -u
git push origin HEAD
# 或
git push -u origin $(git branch --show-current)
```

### ⑦ 汇报
输出一行总结：
```
✅ commit <hash> <short summary>
✅ push   <branch> -> origin/<branch>  (<old>..<new>)
✅ N files changed, +X / -Y
```

## 停下来问用户的场景（⚠️ 不走自动流程）

| 场景 | 为什么停 |
|------|----------|
| 用户要求**创建 PR**而非直接 push main | 可能需要走 code review |
| 改动涉及**破坏性变更**（接口签名改了 / 数据库迁移） | 用户可能想先跑一遍再上线 |
| `gh auth status` 失败 | 需要先刷新 token 或登录 |
| push 返回非 fast-forward（远端有领先提交） | 需要明确是否 rebase / merge |

遇到以上场景时，先输出诊断信息再问用户，不要硬推。

## 本地开发前置

- 运行 `gh auth setup-git` 一次（让 gh token 自动注入 git credential）
- 之后 gh auth status 显示 `Logged in to github.com account <xxx> (GH_TOKEN)` 即可
- 推荐在仓库根目录执行，避免路径问题

## 示例 commit message

```
feat: 企微会话存档对接骨架 + 视频号小店订单 Webhook + 配置项全量补齐

后端：
- 新增 wecom-msgaudit.js：agent_token 缓存、getgroupchat 拉取、RSA 解密
- 新增 routes/msgaudit.js：GET status / POST poll / POST recompute / POST zero
- scheduler 加两条定时器：每 5min pollMsgAudit、每日 0 点归零
- db.js 迁移：wecom_config 加 msg_audit_* 字段 + msg_audit_state + chat_messages
- orders.js 视频号小店 Webhook（AES-256-CBC + WXBizMsgCrypt 验签）
- utils/wecom-crypto.js 企微加解密

前端：
- WecomView 左栏 3 张配置卡
- types 补 WecomConfig + MsgAuditStatus
- api 新增 3 个 msgaudit 接口

未开通会话存档时所有接口安全跳过。
```
