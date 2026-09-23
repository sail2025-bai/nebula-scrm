import { pathToFileURL } from 'node:url'
import crypto from 'node:crypto'
import { db, initSchema, fmt } from './db.js'

const at = (day, hour, minute = 0) => {
  const base = new Date(Date.now() - day * 86400000)
  let d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0)
  if (d.getTime() > Date.now()) d = new Date(Date.now() - 60000)
  return fmt(d)
}

const ahead = (days, hour = 10) => {
  const base = new Date(Date.now() + days * 86400000)
  return fmt(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, 0, 0))
}

const minutesAgo = (m) => fmt(new Date(Date.now() - m * 60000))

const staffSeed = [
  ['林晨', '私域运营总监'],
  ['王芳', '资深美妆顾问'],
  ['周萌', '客服组长']
]

const tagSeed = [
  ['敏感肌护肤', '智能标签'],
  ['高客单', '智能标签'],
  ['社群活跃KOC', '智能标签'],
  ['月度复购', '智能标签'],
  ['45天无互动', '智能标签'],
  ['高客单新客', '智能标签'],
  ['送礼属性', '智能标签'],
  ['油痘肌调理', '智能标签'],
  ['抗初老人群', '智能标签'],
  ['黑金卡会员', '业务标签'],
  ['新人首单券', '业务标签'],
  ['私域首发尝鲜', '业务标签'],
  ['孕妈护肤', '业务标签'],
  ['学生党', '业务标签'],
  ['男士理容', '业务标签'],
  ['节日大促偏好', '业务标签'],
  ['淘宝包裹卡', '渠道标签'],
  ['线下门店', '渠道标签'],
  ['抖音投流', '渠道标签'],
  ['老带新', '渠道标签']
]

const stageMeta = {
  loyal: ['555', '极度健康'],
  mature: ['423', '良好'],
  new: ['511', '新人活跃'],
  churn: ['211', '高危预警']
}

const customerSeed = [
  { name: '苏婉晴', nick: '小婉晴丶', gender: '女', phone: '13812560371', stage: 'loyal', channel: '天猫旗舰店包裹卡', spend: 5680, orders: 14, staff: 2, day: 2, hour: 10, lastMin: 300, notes: '黑金卡会员，敏感肌长期回购', tags: ['黑金卡会员', '月度复购', '敏感肌护肤', '社群活跃KOC'] },
  { name: '顾嘉怡', nick: '嘉怡宝贝', gender: '女', phone: '13906714258', stage: 'loyal', channel: '线下门店专柜扫码', spend: 4860, orders: 11, staff: 1, day: 1, hour: 15, lastMin: 120, notes: '高客单送礼客户，偏好礼盒装', tags: ['黑金卡会员', '高客单', '节日大促偏好'] },
  { name: '沈若彤', nick: '彤彤酱', gender: '女', phone: '15618374902', stage: 'loyal', channel: '天猫旗舰店包裹卡', spend: 5210, orders: 12, staff: 2, day: 3, hour: 9, lastMin: 32, notes: null, tags: ['黑金卡会员', '月度复购', '抗初老人群'] },
  { name: '唐雅琳', nick: '雅琳在逃公主', gender: '女', phone: '18757261034', stage: 'loyal', channel: '老客拼团裂变', spend: 3980, orders: 9, staff: 3, day: 0, hour: 11, lastMin: 60, notes: null, tags: ['黑金卡会员', '社群活跃KOC', '送礼属性'] },
  { name: '韩雨薇', nick: '雨薇不熬夜', gender: '女', phone: '13890247561', stage: 'loyal', channel: '公众号菜单栏', spend: 4520, orders: 10, staff: 2, day: 1, hour: 20, lastMin: 240, notes: null, tags: ['黑金卡会员', '月度复购', '敏感肌护肤'] },
  { name: '郑思琪', nick: '思琪酱鸭', gender: '女', phone: '13975108642', stage: 'loyal', channel: '抖音信息流投流', spend: 5960, orders: 15, staff: 1, day: 2, hour: 14, lastMin: 360, notes: null, tags: ['高客单', '节日大促偏好', '淘宝包裹卡'] },
  { name: '邵一诺', nick: '一诺妈妈', gender: '女', phone: '15632870195', stage: 'loyal', channel: '线下门店专柜扫码', spend: 3860, orders: 8, staff: 3, day: 0, hour: 16, lastMin: 180, notes: '孕期敏感肌重点关注', tags: ['黑金卡会员', '月度复购', '孕妈护肤'] },
  { name: '傅诗涵', nick: '诗涵妈妈咪呀', gender: '女', phone: '18740691523', stage: 'loyal', channel: '老客拼团裂变', spend: 4380, orders: 10, staff: 2, day: 2, hour: 8, lastMin: 300, notes: '社群KOC，乐于晒单分享', tags: ['黑金卡会员', '社群活跃KOC', '私域首发尝鲜'] },
  { name: '陈铭', nick: '陈先生', gender: '男', phone: '13849015276', stage: 'mature', channel: '线下门店专柜扫码', spend: 2680, orders: 6, staff: 1, day: 5, hour: 13, lastMin: 28800, notes: '静默20天未互动，已进入流失预警名单', tags: ['节日大促偏好', '男士理容'] },
  { name: '何静怡', nick: '静怡Jennie', gender: '女', phone: '13963502841', stage: 'mature', channel: '天猫旗舰店包裹卡', spend: 1980, orders: 5, staff: 2, day: 4, hour: 10, lastMin: 4320, notes: null, tags: ['敏感肌护肤', '月度复购'] },
  { name: '邱梦洁', nick: '梦洁小可爱', gender: '女', phone: '15680723419', stage: 'mature', channel: '抖音信息流投流', spend: 860, orders: 3, staff: 3, day: 4, hour: 17, lastMin: 7200, notes: null, tags: ['学生党', '抖音投流'] },
  { name: '邹婷婷', nick: '婷婷玉立', gender: '女', phone: '18729153608', stage: 'mature', channel: '线下门店专柜扫码', spend: 1450, orders: 4, staff: 1, day: 3, hour: 11, lastMin: 2880, notes: null, tags: ['孕妈护肤', '线下门店'] },
  { name: '白若曦', nick: '若曦wx', gender: '女', phone: '13865342071', stage: 'mature', channel: '老客拼团裂变', spend: 3240, orders: 7, staff: 2, day: 3, hour: 19, lastMin: 8640, notes: null, tags: ['高客单', '节日大促偏好'] },
  { name: '康晓萌', nick: '晓萌不吃香菜', gender: '女', phone: '13920875613', stage: 'mature', channel: '天猫旗舰店包裹卡', spend: 1180, orders: 3, staff: 2, day: 4, hour: 9, lastMin: 11520, notes: null, tags: ['敏感肌护肤', '老带新'] },
  { name: '秦岚', nick: '岚岚子', gender: '女', phone: '15694701382', stage: 'mature', channel: '公众号菜单栏', spend: 2650, orders: 6, staff: 1, day: 5, hour: 16, lastMin: 5760, notes: null, tags: ['抗初老人群', '线下门店'] },
  { name: '尤佳', nick: '佳佳爱吃甜', gender: '女', phone: '18753082649', stage: 'mature', channel: '抖音信息流投流', spend: 760, orders: 2, staff: 3, day: 5, hour: 10, lastMin: 12960, notes: null, tags: ['学生党', '淘宝包裹卡'] },
  { name: '章小鱼', nick: '小鱼儿hz', gender: '女', phone: '13802756431', stage: 'mature', channel: '老客拼团裂变', spend: 2120, orders: 5, staff: 2, day: 2, hour: 21, lastMin: 1440, notes: null, tags: ['社群活跃KOC', '老带新'] },
  { name: '严嘉嘉', nick: '嘉嘉酱', gender: '女', phone: '13981037562', stage: 'mature', channel: '天猫旗舰店包裹卡', spend: 1790, orders: 4, staff: 3, day: 4, hour: 14, lastMin: 7200, notes: null, tags: ['敏感肌护肤', '月度复购', '节日大促偏好'] },
  { name: '毛雨桐', nick: '雨桐桐桐', gender: '女', phone: '15624709813', stage: 'mature', channel: '线下门店专柜扫码', spend: 2890, orders: 6, staff: 1, day: 5, hour: 12, lastMin: 10080, notes: null, tags: ['高客单', '私域首发尝鲜'] },
  { name: '阮清清', nick: '清清子', gender: '女', phone: '18736541029', stage: 'mature', channel: '抖音信息流投流', spend: 980, orders: 3, staff: 3, day: 3, hour: 8, lastMin: 14400, notes: null, tags: ['油痘肌调理', '抖音投流'] },
  { name: '杜若溪', nick: '若溪呀', gender: '女', phone: '13876941052', stage: 'new', channel: '天猫旗舰店包裹卡', spend: 260, orders: 2, staff: 2, day: 0, hour: 9, lastMin: 25, notes: null, tags: ['新人首单券', '私域首发尝鲜', '淘宝包裹卡'] },
  { name: '董倩', nick: '倩倩不加班', gender: '女', phone: '13950287631', stage: 'new', channel: '抖音信息流投流', spend: 0, orders: 0, staff: 3, day: 0, hour: 10, lastMin: 40, notes: null, tags: ['新人首单券', '敏感肌护肤'] },
  { name: '袁子珊', nick: '子珊Sandy', gender: '女', phone: '15609473812', stage: 'new', channel: '公众号菜单栏', spend: 180, orders: 1, staff: 1, day: 0, hour: 14, lastMin: 120, notes: null, tags: ['高客单新客', '新人首单券'] },
  { name: '苏黎', nick: '苏黎Sully', gender: '女', phone: '18760139245', stage: 'new', channel: '抖音信息流投流', spend: 0, orders: 0, staff: 3, day: 0, hour: 17, lastMin: 60, notes: null, tags: ['新人首单券', '学生党', '抖音投流'] },
  { name: '费思思', nick: '思思梨', gender: '女', phone: '13831209764', stage: 'new', channel: '天猫旗舰店包裹卡', spend: 128, orders: 1, staff: 2, day: 1, hour: 11, lastMin: 1200, notes: null, tags: ['私域首发尝鲜', '抖音投流'] },
  { name: '雷佳雨', nick: '佳雨JY', gender: '女', phone: '13976531208', stage: 'new', channel: '老客拼团裂变', spend: 96, orders: 1, staff: 1, day: 1, hour: 16, lastMin: 1080, notes: null, tags: ['新人首单券', '油痘肌调理'] },
  { name: '齐悦', nick: '齐悦Kevin', gender: '男', phone: '15682034971', stage: 'new', channel: '抖音信息流投流', spend: 350, orders: 1, staff: 3, day: 1, hour: 20, lastMin: 900, notes: '男士理容潜力客户', tags: ['高客单新客', '男士理容', '抖音投流'] },
  { name: '赵晴', nick: '晴天小妹', gender: '女', phone: '18704596132', stage: 'churn', channel: '线下门店专柜扫码', spend: 1680, orders: 4, staff: 1, day: 6, hour: 10, lastMin: 60480, notes: '已退出护肤二群，需重点挽回', tags: ['45天无互动', '节日大促偏好', '线下门店'] },
  { name: '潘俊熙', nick: '俊熙Junxi', gender: '男', phone: '13859204137', stage: 'churn', channel: '抖音信息流投流', spend: 980, orders: 2, staff: 3, day: 6, hour: 14, lastMin: 64800, notes: '长期未互动，以男士线产品为主', tags: ['45天无互动', '男士理容', '送礼属性'] },
  { name: '冯梦露', nick: '梦露Marilyn', gender: '女', phone: '13923084756', stage: 'churn', channel: '天猫旗舰店包裹卡', spend: 1240, orders: 3, staff: 2, day: 6, hour: 18, lastMin: 59040, notes: '静默超40天，多次唤醒未果', tags: ['45天无互动', '学生党'] }
]

const segmentSeed = [
  { name: '高价值VIP客户', desc: '忠诚阶段且累计消费≥2000的黑金核心客群', cond: { stage: 'loyal', minSpend: 2000 } },
  { name: '流失预警挽回群', desc: '已进入流失预警阶段，需重点挽回的客户', cond: { stage: 'churn' } },
  { name: '7天新客培育池', desc: '近期新添加的企微好友，处于新人培育阶段', cond: { stage: 'new' } }
]

const groupSeed = [
  { name: '【美诺美妆】VIP护肤打卡交流01群', owner: 2, members: 198, capacity: 200, messages: 342, sop: '早晚签到+优惠秒杀', health: 96, day: 60 },
  { name: '【美诺美妆】新品体验专享03群', owner: 2, members: 174, capacity: 200, messages: 128, sop: '新品试用SOP', health: 84, day: 45 },
  { name: '【美诺美妆】华东线下会员福利08群', owner: 1, members: 140, capacity: 200, messages: 12, sop: '唤醒红包SOP', health: 58, day: 30 },
  { name: '【美诺美妆】黑金VIP专属服务群', owner: 1, members: 56, capacity: 200, messages: 89, sop: '专属顾问1v1', health: 91, day: 75 },
  { name: '【美诺美妆】孕妈敏感肌关怀群', owner: 3, members: 112, capacity: 200, messages: 67, sop: '孕期知识科普', health: 78, day: 20 },
  { name: '【美诺美妆】双十一冲刺快闪群', owner: 3, members: 186, capacity: 200, messages: 410, sop: '限时秒杀SOP', health: 93, day: 8 }
]

const followupSeed = [
  { c: '杜若溪', staff: 2, type: 'wechat', content: '新人首单券使用引导，客户已下单小样合集并主动晒单', outcome: '已成交', day: 0, hour: 3 },
  { c: '董倩', staff: 3, type: 'wechat', content: '发送个性化欢迎语与护肤需求问卷，客户已填写混合偏油肤质信息', outcome: '意向中', day: 0, hour: 4 },
  { c: '董倩', staff: 3, type: 'note', content: '新客问卷显示混合偏油肤质，已自动打上肤质标签', outcome: '已记录', day: 0, hour: 5 },
  { c: '袁子珊', staff: 1, type: 'wechat', content: '高客单新客首日关怀：推送会员权益说明与专属顾问名片', outcome: '意向中', day: 0, hour: 6 },
  { c: '赵晴', staff: 1, type: 'wechat', content: '企微私信挽回话术触达，客户未回复，建议电话跟进', outcome: '需再跟进', day: 0, hour: 8, next: 1 },
  { c: '苏黎', staff: 3, type: 'wechat', content: '新人欢迎语已发送，推送新人专享礼包', outcome: '意向中', day: 0, hour: 18 },
  { c: '苏婉晴', staff: 2, type: 'call', content: '电话回访敏肌修护精华使用感受，客户反馈良好，已推荐搭配氨基酸洁面', outcome: '已复购', day: 1, hour: 10 },
  { c: '顾嘉怡', staff: 1, type: 'wechat', content: '朋友圈互动点赞评论，私信推送秋冬新品首发预告', outcome: '意向中', day: 1, hour: 14 },
  { c: '韩雨薇', staff: 2, type: 'wechat', content: '推送敏感肌换季护肤指南，客户主动咨询修护面霜', outcome: '意向中', day: 1, hour: 16, next: 2 },
  { c: '陈铭', staff: 1, type: 'wechat', content: '推送周年庆线下沙龙邀请函，客户已读未回', outcome: '需再跟进', day: 1, hour: 19 },
  { c: '苏黎', staff: 3, type: 'wechat', content: '新人7天培育SOP第2步：推送学生党平价好物清单', outcome: '意向中', day: 1, hour: 20 },
  { c: '杜若溪', staff: 2, type: 'note', content: '新客首单完成，标记为高潜复购客户，纳入7天培育SOP', outcome: '已记录', day: 1, hour: 21 },
  { c: '沈若彤', staff: 2, type: 'wechat', content: '推送抗初老眼霜组合券，客户咨询后已下单', outcome: '已成交', day: 2, hour: 10 },
  { c: '章小鱼', staff: 2, type: 'wechat', content: '社群互动私信感谢，附赠专属复购优惠券', outcome: '已成交', day: 2, hour: 11 },
  { c: '邵一诺', staff: 3, type: 'wechat', content: '孕妈专属护肤知识科普触达，客户回复积极', outcome: '意向中', day: 2, hour: 15 },
  { c: '袁子珊', staff: 1, type: 'wechat', content: '推送品牌故事与会员体系介绍，客户互动积极', outcome: '意向中', day: 2, hour: 17 },
  { c: '傅诗涵', staff: 2, type: 'wechat', content: '新品体验官招募推送，客户报名成功并转发朋友圈', outcome: '已成交', day: 3, hour: 10 },
  { c: '何静怡', staff: 2, type: 'wechat', content: '换季敏肌护理提醒叠加复购券组合推送', outcome: '意向中', day: 3, hour: 14 },
  { c: '赵晴', staff: 1, type: 'call', content: '电话挽回未接通，已留言并发送短信专属回归券', outcome: '需再跟进', day: 4, hour: 9, next: 3 },
  { c: '唐雅琳', staff: 3, type: 'wechat', content: '邀请参加VIP会员日直播专场，客户全程观看并下单礼盒', outcome: '已成交', day: 4, hour: 16 },
  { c: '郑思琪', staff: 1, type: 'wechat', content: '双十一预售定金膨胀活动提醒，客户已付定金锁定优惠', outcome: '已成交', day: 5, hour: 10 },
  { c: '陈铭', staff: 1, type: 'call', content: '电话回访礼盒装使用感受，客户未接通，已静默20天', outcome: '需再跟进', day: 6, hour: 11 },
  { c: '苏婉晴', staff: 2, type: 'wechat', content: '企微推送黑金会员日双倍积分活动，客户已领取', outcome: '已复购', day: 6, hour: 15 },
  { c: '潘俊熙', staff: 3, type: 'wechat', content: '男士理容专区优惠券定向推送，客户已读未回', outcome: '需再跟进', day: 7, hour: 13 },
  { c: '傅诗涵', staff: 2, type: 'note', content: '客户为社群KOC，安排首批新品试用并邀请分享使用心得', outcome: '已记录', day: 8, hour: 10 },
  { c: '顾嘉怡', staff: 1, type: 'visit', content: '线下专柜邀约新品肤质检测，客户到店并当场下单精华套装', outcome: '已成交', day: 9, hour: 15 },
  { c: '章小鱼', staff: 2, type: 'wechat', content: '邀请担任社群体验官，客户欣然接受', outcome: '已成交', day: 9, hour: 18 },
  { c: '邵一诺', staff: 3, type: 'visit', content: '门店一对一孕期护肤咨询，成交孕敏安全系列套组', outcome: '已成交', day: 11, hour: 14 },
  { c: '韩雨薇', staff: 2, type: 'call', content: '回访舒缓面膜使用效果，客户反馈泛红明显改善', outcome: '已复购', day: 11, hour: 16 },
  { c: '何静怡', staff: 2, type: 'call', content: '回访水乳套装使用感受，客户反馈滋润度合适', outcome: '已复购', day: 12, hour: 10 },
  { c: '赵晴', staff: 1, type: 'note', content: '客户已退出护肤二群，标记退群风险，转入自动化挽回SOP', outcome: '已记录', day: 12, hour: 15 },
  { c: '冯梦露', staff: 2, type: 'wechat', content: '唤醒红包SOP触达，客户领取红包但未下单', outcome: '需再跟进', day: 14, hour: 11 },
  { c: '苏婉晴', staff: 2, type: 'gift', content: '寄送生日礼盒小样套装，附手写贺卡', outcome: '已复购', day: 15, hour: 9 },
  { c: '郑思琪', staff: 1, type: 'wechat', content: '推送会员积分兑换清单，客户兑换旅行装', outcome: '已成交', day: 18, hour: 14 },
  { c: '冯梦露', staff: 2, type: 'note', content: '静默流失预警：超过40天无互动，转人工重点跟进', outcome: '已记录', day: 18, hour: 16 },
  { c: '陈铭', staff: 1, type: 'note', content: '静默流失预警标记，安排专属顾问二次触达', outcome: '已记录', day: 19, hour: 10 },
  { c: '沈若彤', staff: 2, type: 'call', content: '季度回访收集产品使用反馈，客户满意度高并愿意转介绍闺蜜', outcome: '已复购', day: 20, hour: 11 },
  { c: '唐雅琳', staff: 3, type: 'note', content: '记录客户送礼偏好：偏好礼盒装，客单稳定在千元以上', outcome: '已记录', day: 25, hour: 13 },
  { c: '潘俊熙', staff: 3, type: 'call', content: '回访洁面套装使用感受，客户表示暂无复购计划', outcome: '意向中', day: 25, hour: 17 }
]

const broadcastSeed = [
  { title: '秋季保湿水光精华首发专享价推送', type: '客户群发', audience: '高价值VIP客户分群 · 21人', message: '亲爱的，秋天的第一瓶水光精华来啦！首发专享价立减80元，前100名加赠旅行装，点击锁定专属优惠~', target: 21, rate: 96.8, status: '已送达', day: 1 },
  { title: '周年庆线下美妆沙龙免费报名征集', type: '客户群发', audience: '华东区域成熟客户分群 · 45人', message: '美诺美妆3周年庆！本周六线下美妆沙龙免费报名，一对一肤质检测+伴手礼，回复【沙龙】占位~', target: 45, rate: 88.2, status: '已送达', day: 3 },
  { title: '新品体验官招募 | 敏感肌专研系列', type: '企业朋友圈', audience: '全部企微好友可见', message: '敏感肌姐妹看过来！新品体验官招募中，免费试用还送定制护肤方案，评论区扣1报名~', target: 0, rate: 0, status: '待下发', day: 0 },
  { title: '双十一预售定金膨胀提醒', type: '企业朋友圈', audience: '节日大促偏好客户分群', message: '定金翻倍最后3天！提前锁定全年低价，速抢~', target: 0, rate: 0, status: '待下发', day: 5 }
]

const sopSeed = [
  {
    name: '新客添加后48小时黄金首购转化SOP',
    trigger: '企微好友通过验证立即激活',
    runCount: 3240,
    conversion: 41.2,
    steps: [
      { phase: '步骤1 · 立即', title: '发送个性化欢迎语', detail: '新人首单券与护肤需求问卷自动推送', metric: '送达率99.8%' },
      { phase: '步骤2 · 24小时后', title: '未用券跟进话术', detail: '针对未用券客户推送限时提醒与搭配建议', metric: '用券转化28.4%' },
      { phase: '步骤3 · 48小时后', title: '精准拉入专属交流群', detail: '按肤质标签邀请进入对应打卡交流群', metric: '进群率61.5%' }
    ]
  },
  {
    name: '沉睡客户30天唤醒流',
    trigger: '客户超过30天未互动自动触发',
    runCount: 1860,
    conversion: 14.8,
    steps: [
      { phase: '步骤1 · 第1天', title: '唤醒红包触达', detail: '发送专属唤醒红包吸引客户回访', metric: '打开率32.1%' },
      { phase: '步骤2 · 第3天', title: '专属回归礼推送', detail: '推送无门槛回归券与新品试用装', metric: '回归率9.6%' },
      { phase: '步骤3 · 第7天', title: '顾问1v1回访', detail: '人工电话回访收集流失原因', metric: '唤醒率14.8%' }
    ]
  },
  {
    name: '高客单售后7天关怀流',
    trigger: '单笔订单金额≥500元自动触发',
    runCount: 2430,
    conversion: 99.1,
    steps: [
      { phase: '步骤1 · 签收当天', title: '发货签收关怀', detail: '推送签收提醒与正品验证指引', metric: '触达率98.5%' },
      { phase: '步骤2 · 第3天', title: '使用指导推送', detail: '发送产品使用手法视频与搭配建议', metric: '打开率76.2%' },
      { phase: '步骤3 · 第7天', title: '好评与晒单邀请', detail: '邀请评价晒单赠送双倍积分', metric: '好评率99.1%' }
    ]
  },
  {
    name: '退群预警自动化挽回',
    trigger: '客户退群或社群活跃度骤降时触发',
    runCount: 960,
    conversion: 24.3,
    steps: [
      { phase: '步骤1 · 退群即时', title: '挽回私信触达', detail: '推送退群挽留话术与回归礼', metric: '回复率41.2%' },
      { phase: '步骤2 · 48小时后', title: '专属回归券下发', detail: '定向发放大额无门槛回归券', metric: '领券率58.7%' },
      { phase: '步骤3 · 第5天', title: '顾问电话挽回', detail: '资深顾问一对一电话沟通挽回', metric: '挽回留存24.3%' }
    ]
  }
]

const serviceTagSeed = [
  ['数字化转型', '业务标签'],
  ['B2B中型企业', '业务标签'],
  ['预算充足', '智能标签'],
  ['已付首期', '业务标签'],
  ['采购决策人', '智能标签'],
  ['定制方案中', '业务标签'],
  ['高客单潜在客户', '智能标签'],
  ['咨询预约', '业务标签'],
  ['待安排电话', '业务标签'],
  ['初创团队', '业务标签'],
  ['30天未回访', '智能标签'],
  ['试听后未反馈', '智能标签'],
  ['招投标进行中', '业务标签'],
  ['上市公司', '业务标签'],
  ['制造业', '业务标签'],
  ['续约窗口期', '智能标签'],
  ['课程培训', '业务标签']
]

const serviceCustomerSeed = [
  { name: '苏曼宁', nick: 'Manning_Su🌱', gender: '女', phone: '13857102468', stage: 'loyal', channel: '官网白皮书下载留资', spend: 180000, orders: 8, lastMin: 10, staff: 2, day: 45, hour: 10, notes: '已付首期款项，项目进入交付对接阶段', tags: ['数字化转型', 'B2B中型企业', '预算充足', '已付首期'], company: '杭州云集数字科技有限公司', position: '数字化负责人', intent: 'A' },
  { name: '赵晴', nick: 'Sunny☀️', gender: '女', phone: '13905714862', stage: 'churn', channel: '巨量千川广告留资', spend: 12800, orders: 2, lastMin: 43200, staff: 1, day: 55, hour: 15, notes: '课程试听后长期未反馈，已转入沉睡激活名单', tags: ['课程培训', '30天未回访', '试听后未反馈'], company: '宁波启润贸易有限公司', position: '培训主管', intent: 'C' },
  { name: '陈铭', nick: 'Calvin.C', gender: '男', phone: '13601853947', stage: 'mature', channel: '行业峰会展位扫码', spend: 65000, orders: 5, lastMin: 1440, staff: 2, day: 30, hour: 9, notes: '定制方案已递交，等待技术总监评估反馈', tags: ['采购决策人', '定制方案中', '高客单潜在客户'], company: '上海蓝湾医疗集团', position: '采购总监', intent: 'A' },
  { name: '李小雅', nick: '雅雅子喵~', gender: '女', phone: '13715208496', stage: 'new', channel: '老客户口碑转介绍', spend: 28000, orders: 1, lastMin: 120, staff: 3, day: 0, hour: 11, notes: null, tags: ['咨询预约', '待安排电话', '初创团队'], company: '深圳青藤文创工作室', position: '创始人', intent: 'B' },
  { name: '吴天泽', nick: '天泽Terry', gender: '男', phone: '13962075184', stage: 'mature', channel: '行业峰会展位扫码', spend: 92000, orders: 6, lastMin: 2880, staff: 2, day: 40, hour: 14, notes: '招投标流程已启动，等待标书递交', tags: ['采购决策人', '招投标进行中', '制造业'], company: '苏州恒瑞精密制造有限公司', position: '信息化总监', intent: 'A' },
  { name: '高晨', nick: '晨光Cheryl', gender: '女', phone: '13881634972', stage: 'mature', channel: '官网白皮书下载留资', spend: 45000, orders: 4, lastMin: 7200, staff: 1, day: 25, hour: 10, notes: null, tags: ['数字化转型', 'B2B中型企业'], company: '成都云图信息科技有限公司', position: '运营总监', intent: 'B' },
  { name: '郑凯文', nick: 'Kevin Zheng', gender: '男', phone: '13521076493', stage: 'new', channel: '巨量千川广告留资', spend: 8000, orders: 1, lastMin: 60, staff: 3, day: 0, hour: 16, notes: null, tags: ['咨询预约', '待安排电话'], company: '北京华正咨询有限公司', position: '市场经理', intent: 'B' },
  { name: '罗静仪', nick: '静仪Jing', gender: '女', phone: '13602857419', stage: 'loyal', channel: '老客户口碑转介绍', spend: 210000, orders: 9, lastMin: 4320, staff: 2, day: 50, hour: 9, notes: '年度框架客户，续约窗口期临近', tags: ['已付首期', '上市公司', '高客单潜在客户'], company: '广州领航商贸集团有限公司', position: '副总裁', intent: 'A' },
  { name: '方启铭', nick: '启铭Simon', gender: '男', phone: '13871126530', stage: 'mature', channel: '行业峰会展位扫码', spend: 76000, orders: 5, lastMin: 11520, staff: 1, day: 20, hour: 11, notes: null, tags: ['招投标进行中', '采购决策人'], company: '武汉光谷智能装备有限公司', position: '技术总监', intent: 'A' },
  { name: '唐诗雨', nick: '诗雨Cynthia', gender: '女', phone: '15951840372', stage: 'churn', channel: '官网白皮书下载留资', spend: 15000, orders: 3, lastMin: 64800, staff: 3, day: 58, hour: 13, notes: '白皮书下载后再无互动，转入沉睡线索池', tags: ['30天未回访'], company: '南京栖霞文化传媒有限公司', position: '人力资源总监', intent: 'C' },
  { name: '蒋文博', nick: '文博Bob', gender: '男', phone: '13735402916', stage: 'new', channel: '巨量千川广告留资', spend: 12000, orders: 1, lastMin: 1200, staff: 2, day: 1, hour: 15, notes: '初创团队，对基础版方案意向明确', tags: ['初创团队', '咨询预约'], company: '杭州星野网络科技股份有限公司', position: '联合创始人', intent: 'B' },
  { name: '韩雪莉', nick: '雪莉Shirley', gender: '女', phone: '13817862045', stage: 'mature', channel: '老客户口碑转介绍', spend: 250000, orders: 7, lastMin: 8640, staff: 1, day: 48, hour: 10, notes: '高客单潜在客户，处于方案报价阶段', tags: ['高客单潜在客户', '续约窗口期', '上市公司'], company: '上海临港半导体材料有限公司', position: '总经理', intent: 'A' },
  { name: '邵一鸣', nick: '一鸣Yves', gender: '男', phone: '13951762840', stage: 'churn', channel: '行业峰会展位扫码', spend: 9800, orders: 2, lastMin: 54720, staff: 3, day: 35, hour: 16, notes: '多次触达未响应，安排顾问上门激活', tags: ['30天未回访', '制造业'], company: '无锡太湖精密模具厂', position: '厂长', intent: 'C' },
  { name: '程雅雯', nick: '雅雯Vivian', gender: '女', phone: '13572480931', stage: 'loyal', channel: '官网白皮书下载留资', spend: 160000, orders: 6, lastMin: 17280, staff: 2, day: 15, hour: 10, notes: '首期交付验收通过，进入续约陪伴阶段', tags: ['数字化转型', '续约窗口期', '已付首期'], company: '西安高新软件园科技有限公司', position: '副总经理', intent: 'A' }
]

const serviceSegmentSeed = [
  { name: '高意向SQL线索', desc: '商机成熟阶段的高意向企业客户，需重点推进诊断会邀约与方案报价', cond: { stage: 'mature' } },
  { name: '沉睡企业线索', desc: '互动趋弱的观察期企业线索，需按激活SOP持续触达唤醒', cond: { maxDaysInactive: 30 } },
  { name: '已签约交付客户', desc: '已签约进入交付阶段的企业客户，重点保障交付质量与续约', cond: { stage: 'loyal' } }
]

const serviceGroupSeed = [
  { name: '苏曼宁项目专属交付对接群', owner: 2, members: 12, capacity: 200, messages: 45, sop: '交付节点提醒', health: 92, day: 30 },
  { name: '2026数字化增长闭门研讨群', owner: 1, members: 38, capacity: 200, messages: 126, sop: '每周话题共创', health: 88, day: 21 },
  { name: '陈铭方案评审专家群', owner: 2, members: 6, capacity: 200, messages: 32, sop: '方案评审跟进', health: 95, day: 12 },
  { name: '华东企业客户服务互通群', owner: 3, members: 54, capacity: 200, messages: 18, sop: '月度服务回访', health: 71, day: 55 }
]

const serviceFollowupSeed = [
  { c: '苏曼宁', staff: 2, type: 'wechat', content: '发送《2026行业数字化方案及案例集》电子版与需求调研表单，客户当日完成填写', outcome: '意向中', day: 26, hour: 10 },
  { c: '苏曼宁', staff: 2, type: 'call', content: '30分钟线上诊断会：梳理业务痛点与技术架构，输出诊断报告初稿', outcome: '意向中', day: 21, hour: 15, next: 3 },
  { c: '苏曼宁', staff: 2, type: 'visit', content: '上门确认首期实施范围，与数字化负责人敲定项目里程碑', outcome: '已成交', day: 8, hour: 14 },
  { c: '陈铭', staff: 2, type: 'call', content: '峰会展位扫码后电话回访，确认采购预算区间与决策链路', outcome: '意向中', day: 12, hour: 11 },
  { c: '陈铭', staff: 2, type: 'wechat', content: '递交定制方案初稿与分项报价，客户已转交技术总监评估', outcome: '需再跟进', day: 3, hour: 16, next: 2 },
  { c: '赵晴', staff: 1, type: 'wechat', content: '发送数字化转型课程试听链接，客户已读未反馈', outcome: '需再跟进', day: 29, hour: 10 },
  { c: '赵晴', staff: 1, type: 'note', content: '标记30天未回访，纳入沉睡企业线索激活SOP', outcome: '已记录', day: 1, hour: 9 },
  { c: '李小雅', staff: 3, type: 'wechat', content: '老客户转介绍致谢，完成需求初步沟通并约定下周电话', outcome: '意向中', day: 0, hour: 5, next: 1 },
  { c: '吴天泽', staff: 2, type: 'wechat', content: '招投标文件解读会邀约确认，客户确认技术总监参会', outcome: '意向中', day: 5, hour: 14 },
  { c: '罗静仪', staff: 2, type: 'visit', content: '年度框架合作协议签署现场拜访，同步敲定下季度增购范围', outcome: '已成交', day: 10, hour: 10 },
  { c: '唐诗雨', staff: 3, type: 'note', content: '45天无互动转入沉睡线索池，安排专家沙龙定向邀约', outcome: '已记录', day: 2, hour: 15 },
  { c: '韩雪莉', staff: 1, type: 'call', content: '续约窗口期沟通，客户明确表达增购数据分析模块意向', outcome: '已成交', day: 6, hour: 11 },
  { c: '方启铭', staff: 1, type: 'wechat', content: '发送智能装备行业解决方案案例集，客户要求安排POC测试', outcome: '意向中', day: 4, hour: 17 },
  { c: '蒋文博', staff: 2, type: 'wechat', content: '初创企业数字化基础包介绍，客户询问首年优惠与实施周期', outcome: '意向中', day: 1, hour: 16 },
  { c: '程雅雯', staff: 2, type: 'call', content: '首期交付验收回访，客户确认验收通过并预约续约方案沟通', outcome: '已成交', day: 7, hour: 10 }
]

const serviceBroadcastSeed = [
  { title: '《2026行业数字化方案及案例集》白皮书推送', type: '客户群发', audience: '全部B端企微线索 · 14人', message: '最新《2026行业数字化方案及案例集》已发布，内含30+标杆企业转型实战案例，点击领取完整版~', target: 14, rate: 100, status: '已完成', day: 2 },
  { title: '数字化增长闭门研讨会定向邀约', type: '客户群发', audience: '高意向SQL线索 · 5人', message: '本周五数字化增长闭门研讨会仅剩少量席位，现场解读降本增效最新实践，回复【研讨】锁定席位~', target: 5, rate: 0, status: '待下发', day: 0 },
  { title: '标杆客户实战案例月度精选', type: '企业朋友圈', audience: '全体B端客户', message: '本月标杆客户实战案例精选已更新：制造、零售、医疗行业头部企业数字化转型全景复盘，欢迎围观~', target: 0, rate: 0, status: '待下发', day: 4 }
]

const serviceSopSeed = [
  {
    name: '高价值线索14天MQL到SQL深度赋能与商机推进SOP',
    trigger: '官网白皮书留资、行业峰会名片、广告线索添加企微顾问',
    runCount: 890,
    conversion: 36.8,
    active: 1,
    steps: [
      { phase: '步骤1 · 立即', title: '下发行业白皮书与调研', detail: '发送《2026行业数字化方案及案例集》附需求调研表单自动提取组织规模', metric: '触达率99.4%' },
      { phase: '步骤2 · 24小时内', title: '顾问1v1预约诊断会', detail: '提醒顾问发起30分钟线上腾讯会议输出专属业务痛点与技术架构诊断报告', metric: '会议邀约率38.5%' },
      { phase: '步骤3 · 第5天', title: '标杆客户视频与评级', detail: '根据白皮书停留阅读时长智能计算意向分自动触发大客户经理分配规则', metric: 'MQL晋级54.2%' },
      { phase: '步骤4 · 第14天', title: '组建专家群与商务方案', detail: '联合技术总监与商务顾问建立专属对接群正式递交方案报价与POC测试', metric: '成单转化31.5%' }
    ]
  },
  {
    name: '大客户招投标与方案7天推进流',
    trigger: '客户进入招投标流程',
    runCount: 210,
    conversion: 68.2,
    active: 1,
    steps: [
      { phase: '步骤1 · 当天', title: '招标文件解读与应标策略会', detail: '商务顾问联合技术总监拆解标书评分项，输出差异化应标策略', metric: '应标方案一次通过率92.3%' },
      { phase: '步骤2 · 第3天', title: '定制方案与报价递交', detail: '按招标要求定制技术方案与分项报价，按时递交电子标书', metric: '按期递交率100%' },
      { phase: '步骤3 · 第7天', title: '评标答疑与决策人沟通', detail: '邀约评标专家线上答疑，重点沟通采购决策人关注事项', metric: '中标率68.2%' }
    ]
  },
  {
    name: '沉睡企业线索60天专家沙龙激活流',
    trigger: '60天无互动的企业线索',
    runCount: 156,
    conversion: 21.4,
    active: 1,
    steps: [
      { phase: '步骤1 · 第1天', title: '沉睡线索分级盘点', detail: '按商机金额与行业自动筛选60天无互动企业线索，生成激活优先级名单', metric: '盘点覆盖率100%' },
      { phase: '步骤2 · 第3天', title: '专家沙龙定向邀约', detail: '发送数字化增长闭门研讨沙龙邀请函，附行业最新政策解读资料', metric: '邀约回复率26.8%' },
      { phase: '步骤3 · 第14天', title: '顾问一对一回访', detail: '顾问电话回访未响应线索，提供免费企业数字化健康度诊断', metric: '激活率21.4%' }
    ]
  },
  {
    name: '客户成功CSM 30/60/90天续约陪伴流',
    trigger: '交付验收完成',
    runCount: 92,
    conversion: 94.6,
    active: 0,
    steps: [
      { phase: '步骤1 · 第30天', title: '交付效果复盘会', detail: 'CSM组织交付成果复盘，输出使用数据报告与优化建议', metric: '复盘出席率96.5%' },
      { phase: '步骤2 · 第60天', title: '增值功能赋能培训', detail: '定向推送高阶功能培训与最佳实践案例，提升产品使用深度', metric: '功能活跃提升42.3%' },
      { phase: '步骤3 · 第90天', title: '续约窗口期谈判启动', detail: '提前锁定续约条款，联合商务准备增值续约方案', metric: '续约率94.6%' }
    ]
  }
]

const serviceLeadSeed = [
  { name: '沈亦舟', company: '杭州临溪网络科技', phone: '13809871234', channel: '官网表单留资', source: '官网白皮书', note: '下载《降本增效白皮书》后留资，需求待电话确认', status: 'pending', day: 6, hour: 10 },
  { name: '路远航', company: '苏州智造装备集团', phone: '13912345678', channel: '行业峰会名片交换', source: '行业峰会', note: '智能制造峰会现场名片交换，关注生产环节数字化', status: 'pending', day: 5, hour: 14 },
  { name: '贺屿', company: '深圳拾光文化', phone: '13766668888', channel: '巨量广告留资', source: '巨量引擎', note: '信息流广告留资，预算区间待摸底', status: 'pending', day: 4, hour: 16 },
  { name: '严子墨', company: '成都云启智造科技', phone: '13566778899', channel: '400电话咨询', source: '400热线', note: '来电咨询ERP数据集成方案，已发送行业案例集', status: 'pending', day: 3, hour: 11 },
  { name: '祁梦瑶', company: '武汉星辰教育集团', phone: '13698765432', channel: '官网表单留资', source: '官网白皮书', note: '留言希望了解学员全生命周期管理系统', status: 'pending', day: 2, hour: 15 },
  { name: '岑飞白', company: '北京极目智能科技', phone: '13711112222', channel: '行业峰会名片交换', source: '行业峰会', note: 'AI视觉赛道初创公司，决策链路短', status: 'pending', day: 1, hour: 10 },
  { name: '池晚舟', company: '上海澜舟供应链有限公司', phone: '13855556666', channel: '巨量广告留资', source: '巨量引擎', note: '已初步沟通仓储数字化需求，等待顾问回访', status: 'claimed', owner: '王芳', day: 1, hour: 15 },
  { name: '阮青山', company: '广州驭风新能源', phone: '13900001111', channel: '官网表单留资', source: '官网白皮书', note: '需求已电话确认并完成签约转客户', status: 'converted', owner: '林晨', day: 8, hour: 9 }
]

const retailLeadSeed = [
  { name: '温言', company: '无公司', phone: '13511112222', channel: '天猫包裹卡未加微', note: '包裹卡扫码领券但未添加企微，待短信召回加微', day: 3, hour: 10 },
  { name: '许愿池', company: '无', phone: '13633334444', channel: '门店咨询未留资', note: '到店体验后离店，仅留下手机号', day: 2, hour: 16 },
  { name: '简糖', company: '无', phone: '13722223333', channel: '小红书种草评论', note: '小红书笔记评论区咨询肤质，待私信引导加微', day: 2, hour: 11 },
  { name: '阿梨', company: '无', phone: '13844445555', channel: '朋友圈裂变海报', note: '参与老带新裂变活动领奖，未完成加微', day: 1, hour: 19 },
  { name: '鹿呦呦', company: '无', phone: '13977778888', channel: '抖音直播间口令', note: '直播间口令中奖用户，待私信引导添加', day: 0, hour: 12 },
  { name: '桃桃乌龙', company: '无', phone: '13599990000', channel: '门店咨询未留资', note: '二次到店意向明显，顾问已认领跟进', status: 'claimed', owner: '周萌', day: 1, hour: 14 }
]

const qrCodeSeed = [
  { name: '【美诺】天猫包裹卡活码', channel: '天猫旗舰店包裹卡', owner: '王芳', tags: ['包裹卡引流', '新客'], scanCount: 28, mode: 'retail', day: 45 },
  { name: '门店立牌活码', channel: '线下智慧门店扫码', owner: '周萌', tags: ['线下体验官'], scanCount: 17, mode: 'retail', day: 30 },
  { name: '抖音投流活码', channel: '抖音信息流投流', owner: '林晨', tags: ['抖音来源'], scanCount: 22, mode: 'retail', day: 20 },
  { name: '裂变海报活码', channel: '老带新裂变', owner: '王芳', tags: ['转介绍', '高价值'], scanCount: 9, mode: 'retail', day: 12 },
  { name: '官网白皮书活码', channel: '官网白皮书下载留资', owner: '林晨', tags: ['数字化转型', '线索'], scanCount: 13, mode: 'service', day: 25 }
]

function seedExtras() {
  const staffIdByName = (name) => {
    const row = db.prepare('SELECT id FROM staff WHERE name = ?').get(name)
    return row ? row.id : null
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM wecom_config').get().n === 0) {
    db.prepare("INSERT INTO wecom_config (id, corp_id, corp_secret, callback_token, encoding_aes_key, status) VALUES (1, '', '', NULL, NULL, 'unset')").run()
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM seas_leads').get().n === 0) {
    const ins = db.prepare('INSERT INTO seas_leads (name, company, phone, wechat_nick, channel, source, note, status, owner_staff_id, claimed_at, mode, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const l of serviceLeadSeed) {
      ins.run(l.name, l.company, l.phone, l.channel, l.source ?? null, l.note ?? null, l.status, l.owner ? staffIdByName(l.owner) : null, l.status === 'pending' ? null : at(l.day, l.hour), 'service', at(l.day, l.hour))
    }
    for (const l of retailLeadSeed) {
      const status = l.status || 'pending'
      ins.run(l.name, l.company, l.phone, l.channel, null, l.note ?? null, status, l.owner ? staffIdByName(l.owner) : null, status === 'pending' ? null : at(l.day, l.hour), 'retail', at(l.day, l.hour))
    }
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM qr_codes').get().n === 0) {
    const ins = db.prepare('INSERT INTO qr_codes (name, channel, staff_id, auto_tags, scan_count, active, mode, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    for (const q of qrCodeSeed) {
      ins.run(q.name, q.channel, staffIdByName(q.owner), JSON.stringify(q.tags), q.scanCount, q.mode, at(q.day, 10))
    }
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM wecom_events').get().n === 0) {
    const ins = db.prepare('INSERT INTO wecom_events (event_type, change_type, external_userid, userid, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    ins.run('change_external_contact', 'add_external_contact', 'wmSIM738291', '王芳', JSON.stringify({ changeType: 'add', name: '苏婉晴', staffId: 2, channel: '模拟活码', tags: ['黑金卡会员'], mode: 'retail' }), at(0, 9))
    ins.run('seas_convert', null, null, '林晨', JSON.stringify({ leadName: '阮青山', customerName: '阮青山', mode: 'service', owner: '林晨' }), at(0, 10))
  }
}

export function seedIfEmpty() {
  const cnt = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n
  if (cnt > 0) {
    seedExtras()
    return false
  }
  const run = db.transaction(() => {
    const insStaff = db.prepare('INSERT INTO staff (name, role, created_at) VALUES (?, ?, ?)')
    for (const [name, role] of staffSeed) insStaff.run(name, role, at(90, 9))

    const insTag = db.prepare('INSERT INTO tags (name, category) VALUES (?, ?)')
    const tagId = {}
    for (const [name, category] of tagSeed) tagId[name] = Number(insTag.run(name, category).lastInsertRowid)

    const insCustomer = db.prepare('INSERT INTO customers (id, code, name, wechat_nick, avatar, gender, phone, stage, channel, spend, orders, last_active, staff_id, rfm_score, health, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const insCT = db.prepare('INSERT INTO customer_tags (customer_id, tag_id) VALUES (?, ?)')
    const idByName = {}
    customerSeed.forEach((c, i) => {
      const id = i + 1
      idByName[c.name] = id
      const meta = stageMeta[c.stage]
      insCustomer.run(id, 'C' + (1001 + i), c.name, c.nick, null, c.gender, c.phone, c.stage, c.channel, c.spend, c.orders, minutesAgo(c.lastMin), c.staff, meta[0], meta[1], c.notes, at(c.day, c.hour))
      for (const t of c.tags) insCT.run(id, tagId[t])
    })

    const insSeg = db.prepare('INSERT INTO segments (name, description, conditions, created_at) VALUES (?, ?, ?, ?)')
    for (const s of segmentSeed) insSeg.run(s.name, s.desc, JSON.stringify(s.cond), at(20, 10))

    const insGroup = db.prepare('INSERT INTO wechat_groups (name, owner_staff_id, member_count, capacity, today_messages, sop_status, health_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const g of groupSeed) insGroup.run(g.name, g.owner, g.members, g.capacity, g.messages, g.sop, g.health, at(g.day, 10))

    const insFollow = db.prepare('INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const f of followupSeed) insFollow.run(idByName[f.c], f.staff, f.type, f.content, f.outcome, f.next ? ahead(f.next) : null, at(f.day, f.hour))

    const insBc = db.prepare('INSERT INTO broadcasts (title, type, audience_desc, message, target_count, sent_rate, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const b of broadcastSeed) insBc.run(b.title, b.type, b.audience, b.message, b.target, b.rate, b.status, at(b.day, 10))

    const insSop = db.prepare('INSERT INTO sops (name, trigger_desc, steps, run_count, conversion, active) VALUES (?, ?, ?, ?, ?, 1)')
    for (const s of sopSeed) insSop.run(s.name, s.trigger, JSON.stringify(s.steps), s.runCount, s.conversion)

    const insUser = db.prepare('INSERT INTO users (name, account, password_hash, business_mode, created_at) VALUES (?, ?, ?, ?, ?)')
    const adminSalt = crypto.randomBytes(16).toString('hex')
    const adminHash = crypto.scryptSync('admin123', adminSalt, 64).toString('hex')
    insUser.run('林晨', 'admin', `${adminSalt}:${adminHash}`, 'retail', at(90, 9))

    const insServiceTag = db.prepare("INSERT INTO tags (name, category, mode) VALUES (?, ?, 'service')")
    const serviceTagId = {}
    for (const [name, category] of serviceTagSeed) serviceTagId[name] = Number(insServiceTag.run(name, category).lastInsertRowid)

    const insServiceCustomer = db.prepare("INSERT INTO customers (id, code, name, wechat_nick, avatar, gender, phone, stage, channel, spend, orders, last_active, staff_id, rfm_score, health, notes, customer_type, company, position, intent_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'service', ?, ?, ?, ?)")
    const serviceIdByName = {}
    serviceCustomerSeed.forEach((c, i) => {
      const id = 31 + i
      serviceIdByName[c.name] = id
      const meta = stageMeta[c.stage]
      insServiceCustomer.run(id, 'S' + (1001 + i), c.name, c.nick, null, c.gender, c.phone, c.stage, c.channel, c.spend, c.orders, minutesAgo(c.lastMin), c.staff, meta[0], meta[1], c.notes, c.company, c.position, c.intent, at(c.day, c.hour))
      for (const t of c.tags) insCT.run(id, serviceTagId[t])
    })

    const insServiceSeg = db.prepare("INSERT INTO segments (name, description, conditions, created_at, mode) VALUES (?, ?, ?, ?, 'service')")
    for (const s of serviceSegmentSeed) insServiceSeg.run(s.name, s.desc, JSON.stringify(s.cond), at(15, 10))

    const insServiceGroup = db.prepare("INSERT INTO wechat_groups (name, owner_staff_id, member_count, capacity, today_messages, sop_status, health_score, created_at, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'service')")
    for (const g of serviceGroupSeed) insServiceGroup.run(g.name, g.owner, g.members, g.capacity, g.messages, g.sop, g.health, at(g.day, 10))

    const insServiceFollow = db.prepare('INSERT INTO follow_ups (customer_id, staff_id, type, content, outcome, next_followup_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const f of serviceFollowupSeed) insServiceFollow.run(serviceIdByName[f.c], f.staff, f.type, f.content, f.outcome, f.next ? ahead(f.next) : null, at(f.day, f.hour))

    const insServiceBc = db.prepare("INSERT INTO broadcasts (title, type, audience_desc, message, target_count, sent_rate, status, created_at, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'service')")
    for (const b of serviceBroadcastSeed) insServiceBc.run(b.title, b.type, b.audience, b.message, b.target, b.rate, b.status, at(b.day, 10))

    const insServiceSop = db.prepare('INSERT INTO sops (name, trigger_desc, steps, run_count, conversion, active, mode) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const s of serviceSopSeed) insServiceSop.run(s.name, s.trigger, JSON.stringify(s.steps), s.runCount, s.conversion, s.active, 'service')
  })
  run()
  seedExtras()
  return true
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  initSchema()
  const inserted = seedIfEmpty()
  console.log(inserted ? '[seed] 种子数据已插入完成' : '[seed] 数据库非空，跳过种子数据')
}
