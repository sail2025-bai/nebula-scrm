---
name: "scrm-customer-care"
description: "客户 360° 画像分析与个性化跟进建议。当用户说 看这个客户、客户档案、跟进建议、给 XX 客户出方案时 Invoke。"
---

# 客户 360° 关怀

## 触发词

"看一下客户 XX" / "客户档案" / "跟进建议" / "给 XX 客户出个方案" / "分析下这个客户" / "客户画像"

## 工作流（3 步）

### Step 1 · 确定客户 ID

- 用户说名字 → `search_customers({ keyword: "张三" })` → 拿 id
- 用户直接给 id → 用就行
- 用户说手机号 → `search_customers({ keyword: "138xxxx" })`

### Step 2 · 拉完整画像

```
tool: get_customer_timeline
args: { id: <customer_id> }
```

返回的 timeline 包含三类事件：
- `order` 订单历史 + 金额 + 状态
- `followup` 跟进记录（谁、什么时候、说了啥）
- `event` 事件总线（order_paid、chat_keyword、stage_changed 等）

### Step 3 · 生成 360° 分析报告

按以下结构输出：

```
👤 客户 #<id> <姓名> 360° 画像

一、基础档案
  · 阶段: loyal | mature | churn | new
  · 业务模式: retail | service
  · 渠道: wechat | video | store | ads | ...
  · 首次入池: YYYY-MM-DD
  · 最近活跃: YYYY-MM-DD
  · 企微昵称 / 电话: ...

二、消费全景
  · 累计消费: ¥X
  · 订单数: X 单
  · 平均客单价: ¥X
  · 首单 → 最近一单间隔: X 天
  · 订单来源分布: seckill X%, coupon X%, manual X%

三、跟进历史
  最近 N 次:
  · [2026-09-20] wechat: "..."
  · [2026-09-15] call: "..."

四、风险信号（如果有）
  ⚠️ 连续 30 天无活跃
  ⚠️ 最后跟进 outcome="异议处理中" 未闭环
  ⚠️ 券过期未核销

五、个性化建议
  · 跟进时机: 根据 last_active + outcome 推断
  · 话术方向: 基于渠道偏好 + 历史互动风格
  · 具体动作: 创建跟进 / 创建群发 / 升级阶段
```

### Step 4 · 可选：记录跟进

如果用户说"帮我记一笔跟进"：

```
tool: add_follow_up
args: {
  customer_id: <id>,
  type: "wechat" | "call" | "visit" | "gift" | "note",
  content: "<用户说的内容>",
  outcome: "<结果描述，可选>"
}
```

记录后**自动更新**该客户的 `last_active` 时间戳（tool 内部已处理）。

### Step 5 · 可选：创建新客户

如果用户说"这个人需要进系统"：

```
tool: create_customer
args: {
  name: "<姓名>",
  wechat_nick: "",
  phone: "",
  channel: "wechat",
  tags: ["新客", "待跟进"],
  mode: "retail"
}
```

标签会自动 upsert 并关联（不需要用户提前创建 tag）。

## 安全约束

- ❌ 永远不要编造 timeline 里没有的订单/跟进/事件
- ❌ 写操作（create_customer / add_follow_up）必须等用户**明确说"帮我记"或"创建"**才调用，不要自动写
- ✅ 建议可以大胆给，但写操作要确认
