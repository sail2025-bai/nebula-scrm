import express from 'express'
import { db } from '../db.js'

const router = express.Router()

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM staff ORDER BY id').all())
})

export default router
