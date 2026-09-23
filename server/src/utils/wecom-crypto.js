import crypto from 'node:crypto'

/**
 * 微信加密回调通用工具（企业微信 / 视频号小店 共用 WXBizMsgCrypt 协议）
 *
 * 签名算法: SHA1(token + timestamp + nonce + encrypt)
 * 解密算法: AES-256-CBC
 *   EncodingAESKey(base64) → 32 字节 Key，前 16 字节做 IV
 *   明文结构: [16字节随机串][4字节网络序 msg_len][msg JSON][AppID]
 */

export function sha1Signature(token, timestamp, nonce, encrypt) {
  const arr = [token || '', timestamp || '', nonce || '', encrypt || ''].sort().join('')
  return crypto.createHash('sha1').update(arr).digest('hex')
}

/** 企业微信/视频号小店的验签：注意企业微信只签 token+ts+nonce；视频号小店还会带上 encrypt —— 两个都兼容 */
export function verifyWxSignature(token, timestamp, nonce, signature, encrypt = null) {
  // 企业微信/视频号小店统一签名规则：对 token, timestamp, nonce, encrypt（如有）先字典序排序再 SHA1
  const arr = encrypt ? [token, timestamp, nonce, encrypt] : [token, timestamp, nonce]
  const expected = crypto.createHash('sha1').update(arr.sort().join('')).digest('hex')
  return String(signature || '').toLowerCase() === expected.toLowerCase()
}

/**
 * AES-256-CBC 解密微信 Encrypt 字段
 * @param {string} encrypt - base64 的密文
 * @param {string} encodingAesKey - 43 字符的 base64 key
 * @returns {{ msg: string, appid: string }} 明文消息和 AppID
 */
export function decryptWxEncrypt(encrypt, encodingAesKey) {
  if (!encrypt || !encodingAesKey) throw new Error('缺 Encrypt 或 EncodingAESKey')

  // base64 解码得到 32 字节 key
  const keyBuf = Buffer.from(encodingAesKey + '=', 'base64')
  if (keyBuf.length !== 32) throw new Error('EncodingAESKey 解码后必须是 32 字节')

  const iv = keyBuf.subarray(0, 16)
  const cipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv)
  const cipherBuf = Buffer.from(encrypt, 'base64')
  const plain = Buffer.concat([cipher.update(cipherBuf), cipher.final()])

  // 明文: 16字节随机串 + 4字节网络序 msg_len + msg + appid
  if (plain.length < 20) throw new Error('解密后的明文过短')

  const msgLen = plain.subarray(16, 20).readUInt32BE(0)
  const msg = plain.subarray(20, 20 + msgLen).toString('utf-8')
  const appid = plain.subarray(20 + msgLen).toString('utf-8')

  return { msg, appid }
}

/**
 * AES-256-CBC 加密（用于构造测试报文）
 */
export function encryptWxForTest(msg, appid, encodingAesKey) {
  const keyBuf = Buffer.from(encodingAesKey + '=', 'base64')
  const iv = keyBuf.subarray(0, 16)

  const random = crypto.randomBytes(16)
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(Buffer.byteLength(msg, 'utf-8'), 0)
  const appidBuf = Buffer.from(appid, 'utf-8')
  const full = Buffer.concat([random, lenBuf, Buffer.from(msg, 'utf-8'), appidBuf])

  // PKCS7 padding
  const blockSize = 32
  const pad = blockSize - (full.length % blockSize)
  const padded = Buffer.concat([full, Buffer.alloc(pad, pad)])

  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, iv)
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()])
  return encrypted.toString('base64')
}

/** 解析 payload —— 视频号小店有的回调是 XML，有的是 JSON */
export function parseWxPayload(raw) {
  // raw 可能是 JSON 字符串，也可能是 { Encrypt, MsgSignature, Timestamp, Nonce, ToUserName }
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return raw }
  }
  return raw
}
