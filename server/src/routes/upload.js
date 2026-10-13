import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const UPLOAD_DIR = path.join(ROOT, 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const router = express.Router()

// === multer 配置：存到 server/uploads，按日期分目录 ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = new Date()
    const sub = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
    const dir = path.join(UPLOAD_DIR, sub)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png'
    const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext) ? ext : '.png'
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`
    cb(null, unique)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },   // 5MB 上限
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('只支持图片类型（jpg/png/gif/webp/svg）'))
  }
})

/** POST /api/upload/image — 上传单图
 *  form-data: { file: <binary> }
 *  返回: { url: "/uploads/202610/xxx.png", size, mimetype, original }
 */
router.post('/image', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件（字段名必须是 file）' })
  const rel = path.relative(UPLOAD_DIR, req.file.path).replace(/\\/g, '/')
  res.json({
    url: `/uploads/${rel}`,
    size: req.file.size,
    mimetype: req.file.mimetype,
    original: req.file.originalname
  })
})

/** POST /api/upload/images — 多图上传（最多 9 张） */
router.post('/images', upload.array('files', 9), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '未收到文件' })
  const items = req.files.map(f => {
    const rel = path.relative(UPLOAD_DIR, f.path).replace(/\\/g, '/')
    return { url: `/uploads/${rel}`, size: f.size, mimetype: f.mimetype, original: f.originalname }
  })
  res.json({ items })
})

// multer 错误处理
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '文件超过 5MB 限制' })
  if (err.message) return res.status(400).json({ error: err.message })
  next(err)
})

export default router
