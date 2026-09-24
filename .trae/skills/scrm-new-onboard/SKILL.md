---
name: "scrm-new-onboard"
description: "新客 SOP 跟进：从入池到首单的标准动作编排。当用户说 新客怎么跟、新客 SOP、新客户首次跟进、刚加的好友怎么聊时 Invoke。"
---

# 新客 SOP 跟进

## 触发词

"新客怎么跟" / "新客 SOP" / "新客户首次跟进" / "刚加的好友怎么聊" / "stage=new 的客户" / "新客转化"

## 工作流（5 步）

### Step 1 · 拉新客池

```
tool: search_customers
args: {
  stage: "new",              // 新客，还没产生消费
  order_by: "created_at",    // 最早入池的优先
  limit: 20                  // 一次最多处理 20 位
}
```

### Step 2 · 看每个新客的入池来源

```
// 逐个拉 timeline，看怎么进来的
tool: get_customer_timeline
args: { id: <customer_id> }
```

重点看 timeline 里的事件：
- `event` 里有 `customer_stage_changed` / `qr_scanned` / `channel_created` / `order_manual_created`
- `followup` 有没有被提前跟进过

### Step 3 · 按入池来源匹配跟进策略

| 入池来源 | 首单跟进策略 |
|----------|-------------|
| `qr_codes` 渠道 | 扫码自动触发 → 12 小时内发 "XX 好，感谢扫码关注，这是专属你新客的 XX 礼券" |
| `seckill_activities` | 秒杀活动 → 24 小时内跟进 "XX，你上次秒的 XX 还满意吗？这个月还有新场次" |
| `coupon_issues` | 领券但未核销 → 礼券 48h 到期前提醒 "XX 好，你的 XX 券还有 2 天到期，要不要来店里看看" |
| `channels_shop`（视频号） | 从视频号来 → 评论互动+私信 "XX 你好，看到你在视频号留言 XX" |
| 未知来源 | 新客通用模板 "XX 好，我是 XX，后续会持续给你发 XX 活动" |

### Step 4 · 生成每个新客的跟进建议卡

```
👤 新客 #123 李四 | 2026-09-22 入池 | 来源: qr_codes 线下门店

  【画像】
    · 性别: 男 | 业务模式: retail
    · 留资方式: 扫码自动采集
    · 标签: VIP潜在客

  【建议跟进】
    · 时机: 入池后 12 小时内 → 今天下午 3 点发
    · 渠道: 企微（因为是扫码）
    · 话术: "李总好，感谢您今天到门店体验！这是专属于扫码新客的 8.8 折券，72 小时内有效~"
    · 动作: 发券 → 次日 14:00 短信提醒 → 3 天后电话确认
```

### Step 5 · 可选：记录跟进

如果用户说"帮我记一笔"：

```
tool: add_follow_up
args: {
  customer_id: <id>,
  type: "wechat",
  content: "<实际发的内容>",
  outcome: "待回复"           // 还没收到回复
}
```

### 自动触发的 stage 升级建议

```
// 跑 daily report 之后，如果发现有 new 客产生了首单
tool: list_orders
args: { customer_id: <id>, status: "completed", limit: 1 }
// → 自动建议升级 stage: new → mature
```

## 不要做的事

- ❌ 不要自动群发（群发草稿可以创建，但要用户确认）
- ❌ 不要编造客户信息，timeline 返回什么就说什么
- ✅ 建议可以大胆给，写操作要有用户明确指令
