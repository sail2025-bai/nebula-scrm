import { verifyWxSignature, decryptWxEncrypt } from './wecom-crypto.js'

/**
 * utils/webhooks.js — 微信系加密回调公共辅助
 *
 * 企业微信 / 视频号小店 共用 WXBizMsgCrypt 协议，但两者又各自有一套本地实现
 * （wecom.js 里的 WXBizMsgCrypt vs utils/wecom-crypto.js 的 verifyWxSignature + decryptWxEncrypt）。
 * 本文件统一处理 routes/orders.js 用的那套（裸 JSON 可跳过加密），
 * routes/wecom.js 里的 WXBizMsgCrypt 暂时保留不动。
 */

/**
 * 从 req.headers / body 里抽取微信签名三元组
 *
 * 企业微信把签名放在 query msg_signature + timestamp + nonce；
 * 视频号小店还会把 MsgSignature / Timestamp / Nonce 塞进 body。
 */
export function extractWxSigTriple({ headers, body, query }) {
  const signature = headers['x-wx-signature']
    || headers['x-wechat-signature']
    || body.MsgSignature
    || body.msg_signature
    || (query && query.msg_signature)
    || null
  const timestamp = headers['x-wx-timestamp']
    || headers['x-wechat-timestamp']
    || body.Timestamp
    || (query && query.timestamp)
    || String(Math.floor(Date.now() / 1000))
  const nonce = headers['x-wx-nonce']
    || headers['x-wechat-nonce']
    || body.Nonce
    || (query && query.nonce)
    || String(Math.floor(Math.random() * 1e9))
  return { signature, timestamp, nonce }
}

/**
 * 处理加密 / 裸 JSON 两种回调形态，统一返回明文 body。
 *
 * @param {object} body       - req.body（POST body JSON）
 * @param {object} headers    - req.headers
 * @param {object} query      - req.query（GET 场景下 echostr 用）
 * @param {object} cfg        - { token, aesKey, appid? }  null 字段表示"未配置加密，走裸 JSON"
 * @returns {{ parsed: object, decryptedAppid: string | null, encryptionUsed: boolean }}
 * @throws {Error}            - 签名校验失败 / Encrypt 解密失败
 */
export function decryptEncryptedCallback({ body = {}, headers = {}, query = {} }, cfg) {
  const { signature, timestamp, nonce } = extractWxSigTriple({ headers, body, query })
  const token = cfg?.token || cfg?.callback_token || null
  const aesKey = cfg?.aesKey || cfg?.encoding_aes_key || null
  const appid = cfg?.appid || null

  // —— 分支 A：真正的加密回调（Body 里有 Encrypt 且 header 有签名）——
  if (body.Encrypt && signature) {
    if (!token || !aesKey) {
      // 未配置加密 → 裸 JSON 回退（兼容第三方 SaaS 直接传裸 JSON 的场景）
      console.warn('[webhooks] 收到加密回调但未配置 token / aesKey，回退到裸 JSON')
      return { parsed: body, decryptedAppid: null, encryptionUsed: false }
    }
    if (!verifyWxSignature(token, timestamp, nonce, signature, body.Encrypt)) {
      throw new Error(`签名校验失败 token_mask=${token?.slice(0, 4)}***`)
    }
    const { msg, appid: gotAppid } = decryptWxEncrypt(body.Encrypt, aesKey)
    if (appid && gotAppid && appid !== gotAppid) {
      console.warn('[webhooks] AppID 不匹配', { configured: appid, received: gotAppid })
    }
    return { parsed: JSON.parse(msg), decryptedAppid: gotAppid, encryptionUsed: true }
  }

  // —— 分支 B：裸 JSON（第三方 SaaS / 手动测试）——
  return { parsed: body, decryptedAppid: null, encryptionUsed: false }
}

/**
 * GET /webhook?...msg_signature=...echostr=... 的服务器配置验证
 *
 * @returns {{ body: string, status: number }} body 是 echostr 明文 / decrypt 后的明文 / ok
 */
export function handleEcho({ query }, cfg) {
  const token = cfg?.token || cfg?.callback_token || null
  const aesKey = cfg?.aesKey || cfg?.encoding_aes_key || null
  const { signature, timestamp, nonce } = extractWxSigTriple({ headers: {}, body: {}, query })

  if (token && signature && query.echostr && verifyWxSignature(token, timestamp, nonce, signature)) {
    if (aesKey) {
      try {
        const { msg } = decryptWxEncrypt(String(query.echostr), aesKey)
        return { body: msg, status: 200 }
      } catch (e) {
        return { body: 'echostr 解密失败', status: 400 }
      }
    }
    return { body: String(query.echostr), status: 200 }
  }
  return { body: 'ok', status: 200 }
}
