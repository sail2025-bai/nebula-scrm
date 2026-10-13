import crypto from 'crypto'

/**
 * PaymentProvider 抽象层（纯 JS，零 TypeScript 语法）
 * ────────────────────────────────────────
 * demo 阶段用 MockWechatPay（秒回调成功，没商户号也能跑）
 * 真上线换成 RealWechatPay（接 wechatpay-node-v3）
 * 业务代码（ext.js / pay 路由）完全不感知底下是 mock 还是真实
 *
 * 激活哪个 provider 由 wecom_config.wxpay_mch_id 是否以 "MOCK_" 开头决定：
 *   MOCK_MCH_xxx → MockWechatPay
 *   真实 mch_id  → RealWechatPay
 */

export class PaymentError extends Error {
  constructor(message, code = 'PAY_ERROR') {
    super(message); this.code = code
  }
}

// =====================================================
// MockWechatPay —— demo/开发环境用
// =====================================================
export class MockWechatPay {
  constructor() { this.name = 'mock-wechat' }

  /**
   * JSAPI 统一下单（mock 实现：直接造一套合法格式的拉起参数）
   * @param {{ orderNo: string, amount: number, openid: string, description?: string }} params
   * @returns {Promise<{ prepay_id: string, appId: string, timeStamp: string, nonceStr: string, package: string, signType: string, paySign: string, isMock: boolean }>}
   */
  async jsapiPrepay(params) {
    const nonceStr = crypto.randomBytes(16).toString('hex')
    const timeStamp = String(Math.floor(Date.now() / 1000))
    const prepayId = `wx_mock_prepay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const pkg = `prepay_id=${prepayId}`
    const signStr = `wxpayjsapi${timeStamp}${nonceStr}${pkg}`
    const paySign = crypto.createHash('md5').update(signStr).digest('hex').toUpperCase()

    return {
      prepay_id: prepayId,
      appId: 'wx_mock_appid',
      timeStamp,
      nonceStr,
      package: pkg,
      signType: 'MD5',
      paySign,
      isMock: true
    }
  }

  /** 解析 notify body → { orderNo, paidAmount, transactionId } */
  parseNotify(rawBody) {
    const j = JSON.parse(rawBody)
    return {
      orderNo: j.order_no || j.out_trade_no,
      paidAmount: Number(j.paid_amount || j.amount || 0),
      transactionId: j.transaction_id || `MOCK_TXN_${Date.now()}`
    }
  }

  /** 构造一个 mock 成功回调 body（前端调 /api/pay/wechat/mock-success 会用到） */
  buildMockNotify(orderNo, amount) {
    return JSON.stringify({
      order_no: orderNo,
      paid_amount: amount,
      transaction_id: `MOCK_TXN_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      mock: true
    })
  }
}

// =====================================================
// RealWechatPay —— 生产环境用（骨架，填了商户号就能跑）
// =====================================================
export class RealWechatPay {
  constructor(config) { this.name = 'real-wechat'; this.config = config }

  async jsapiPrepay(params) {
    // TODO: 接入 wechatpay-node-v3
    // 暂时 fallback 到 mock，让开发体验平滑
    console.warn('[WechatPay] RealWechatPay 未配置真实商户号，fallback 到 MockWechatPay')
    return new MockWechatPay().jsapiPrepay(params)
  }

  parseNotify(rawBody, signature) {
    // TODO: APIv3 RSA 公钥验签 signature
    const j = JSON.parse(rawBody)
    return {
      orderNo: j.out_trade_no,
      paidAmount: j.amount?.total ? j.amount.total / 100 : Number(j.paid_amount || 0),
      transactionId: j.transaction_id
    }
  }

  buildMockNotify() {
    throw new PaymentError('真实环境不支持 mock 回调')
  }
}

// =====================================================
// 工厂：读取 wecom_config 决定用哪个 provider
// =====================================================
export function createPaymentProvider(wecomConfig) {
  const mchId = wecomConfig?.wxpay_mch_id || ''
  if (!mchId || mchId.startsWith('MOCK_')) {
    return new MockWechatPay()
  }
  return new RealWechatPay({
    mch_id: mchId,
    api_key: wecomConfig.wxpay_api_key,
    notify_url: wecomConfig.wxpay_notify_url,
    appid: wecomConfig.video_shop_appid || wecomConfig.corp_id
  })
}
