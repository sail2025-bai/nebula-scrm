---
name: "scrm-segment-analyze"
description: "客群对比分析与洞察。当用户说 A客群和B客群对比、分群差异、客群洞察、人群分析时 Invoke。"
---

# 客群对比洞察

## 触发词

"A 和 B 客群有什么区别" / "客群对比" / "分群差异" / "这个人群怎么样" / "对比两个客群" / "客群洞察" / "人群分析"

## 工作流（4 步）

### Step 1 · 列出所有客群

```
tool: list_segments
args: {}  // 或 { mode: "retail" } / { mode: "service" }
```

返回每个分群的：id、name、conditions（JSON）、实时圈选人数、snapshot 冻结状态。

**如果用户没说具体对比哪两个**，先给用户展示分群列表，让他选。

### Step 2 · 基础对比（overlap / 规模）

```
tool: compare_segments
args: { id1: <A>, id2: <B>, use_snapshot: false }
```

如果其中一个分群有 frozen snapshot 且用户说"用上次的快照对比"，加 `use_snapshot: true`。

返回：overlap（重叠人数）、union（并集）、only_in_seg1 / only_in_seg2。

### Step 3 · 分层指标对比（聚合）

对每个分群跑 analytics，按**相同时间范围**：

```
// A 客群的消费分布
tool: run_custom_analytics
args: {
  table: "orders", agg: "sum", field: "paid_amount",
  group_by: "source",
  time_from: "<30天前>", time_to: "<今天>"
}
// B 客群同样跑一遍

// 新客 vs 老客占比
tool: run_custom_analytics
args: {
  table: "customers", agg: "count",
  time_col: "created_at", time_gran: "day",
  time_from: "<30天前>", time_to: "<今天>"
}
```

### Step 4 · 输出洞察报告

```
⚖️ 客群对比报告：[客群A名] vs [客群B名]

一、规模对比
  · A 客群: X 人 | B 客群: Y 人 | 重叠: Z 人 | 仅 A: X-Z | 仅 B: Y-Z

二、消费能力
  · A 总消费 ¥X（人均 ¥a） | B 总消费 ¥Y（人均 ¥b）
  · A 平均客单价 ¥X | B 平均客单价 ¥Y
  · 谁更强 + 可能原因

三、渠道偏好
  · A 订单来源 Top: seckill X%, coupon Y%
  · B 订单来源 Top: channels_shop X%, manual Y%
  · 差异洞察

四、活跃状态
  · A 近 30 天活跃率 X% | B Y%
  · A 流失率 X% | B Y%

五、建议
  · 分群条件是否需要调整？（based on overlap 比例）
  · 哪个客群更值得投放资源？
  · 是否需要 snapshot 固化当前状态用于后续跟踪？
```

### 可选：冻结快照

如果用户说"固定下这个客群的基线"：

```
tool: snapshot_segment
args: { id: <segment_id> }
```

冻结后 `snapshot_count` 写入当前圈选人数，后续 compare 可用 `use_snapshot: true` 对比"当初" vs "现在"的变化。

## 白名单表（run_custom_analytics 限定）

只能查以下 7 张表的白名单字段：

| 表 | 可用字段 |
|----|----------|
| customers | id, name, wechat_nick, stage, channel, spend, orders, last_active, created_at |
| orders | id, order_no, customer_id, paid_amount, status, order_at, source |
| follow_ups | id, customer_id, type, created_at |
| events | id, type, customer_id, created_at |
| broadcasts | id, title, type, status, created_at |
| sop_runs | id, sop_id, success_count, target_count, created_at |
| coupon_redemptions | id, customer_id, order_amount, saved_amount, redeemed_at |

## 安全约束

- ❌ `group_by` / `time_col` 必须在白名单里，否则 tool 会报错——遇到报错给用户解释，不要硬编
- ✅ 建议用户调整分群条件时，用自然语言描述，让用户自己在前端分群页改，MCP tool 只能**读** conditions 不能改
