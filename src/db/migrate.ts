import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const pool = new pg.Pool({ connectionString: databaseUrl })
try {
  const sql = await readFile(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8')
  await pool.query(sql)
  console.log('Database schema and simulated menu are ready.')
} finally { await pool.end() }
