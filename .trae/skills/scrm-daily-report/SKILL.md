---
name: "scrm-daily-report"
description: "生成星云企微 SCRM 每日运营日报。当用户问今天经营数据、出日报、看数据大盘、近 7 天趋势时 Invoke。"
---

# 每日运营日报

## 触发词

"今天数据" / "出日报" / "数据大盘" / "近 7 天趋势" / "本周经营情况" / "运营日报"

## 工作流（4 步）

### Step 1 · 取核心指标

```
tool: get_dashboard_stats
args: {}                                    // 全模式
args: { mode: "retail" }                    // 或 { mode: "service" }
```

拿到：总客户、今日新增、本周新增、今日订单额、总消费、平均客单价、复购率。

### Step 2 · 拉趋势数据（近 7 天）

```
tool: run_custom_analytics
args: {
  table: "orders", agg: "sum", field: "paid_amount",
  time_col: "order_at", time_gran: "day",
  time_from: "<7天前>", time_to: "<今天>"
}
// 同时跑一条订单数趋势：
args: { table: "orders", agg: "count", time_col: "order_at", time_gran: "day", ... }
// 同时跑一条新客数趋势：
args: { table: "customers", agg: "count", time_col: "created_at", time_gran: "day", ... }
```

### Step 3 · 按渠道拆分

```
tool: run_custom_analytics
args: {
  table: "orders", agg: "sum", field: "paid_amount",
  group_by: "source"
}
```

看各来源（manual/seckill/coupon/channels_shop/...）的贡献占比。

### Step 4 · 生成中文日报

按以下模板组织语言，**不要输出原始 JSON**：

```
📰 星云企微 SCRM · 运营日报（YYYY-MM-DD）

【今日核心】
  · 今日新增客 X 位 | 今日订单 Y 单 | 今日成交额 ¥Z
  · 较昨日 ↑/↓X%

【本周趋势】
  · 本周累计新增客 X 位（日均 Y）
  · 本周成交总额 ¥X（日均 ¥Y）
  · 订单数 / 新客数 7 日折线：列出关键拐点

【渠道贡献 Top3】
  1. channels_shop ¥X 占 Y%
  2. seckill ¥X 占 Y%
  3. coupon ¥X 占 Y%

【健康度】
  · 活跃客户率 X%（今日有跟进/下单）
  · 复购率 X%
  · 平均客单价 ¥X

【异常与建议】
  · 今日 seckill 渠道成交下滑：建议检查库存/活动配置
  · coupon 核销率仅 X%：建议给券设置过期提醒
```

## 可选：指定业务模式

如果用户明确说"看 B 端"或"零售渠道"，在 **Step 1** 加 `mode` 参数，后续 analytics 查询同样过滤。

## 可选：手动触发日报入库

```
tool: generate_daily_report
args: {}               // 生成今天
args: { day: "2026-09-23" }
```

生成结果写入 `wecom_events` 表，之后 `get_daily_report(days: 7)` 可直接拉取历史。

## 不要做的事

- ❌ 不要直接调 16 个 tool 的原始 JSON 输出给用户，要翻译成人话
- ❌ 不要编造数据，所有数字必须来自 tool 返回值
- ❌ 不要漏掉趋势对比，只有绝对值的日报没有洞察价值
