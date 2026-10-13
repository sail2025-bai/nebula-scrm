/**
 * Express 4 不自动把 async route handler 的 rejection 转给 error handler。
 * 用 wrapAsync 包一层，让 async 路由里的 throw 能走到 app.use((err, ...))
 *
 * 用法：
 *   router.get('/', wrapAsync(async (req, res) => {
 *     const rows = db.prepare('SELECT * FROM customers').all()
 *     return res.json(rows)
 *   }))
 */
export const wrapAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    // 开发环境打印完整 stack，生产走 error handler
    if (process.env.NODE_ENV !== 'prod') console.error('[wrapAsync]', err.stack || err.message)
    next(err)
  })
}
