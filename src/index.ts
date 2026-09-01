import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { createApp } from './app.js'

const config = loadConfig()
const pool = createPool(config)
const app = createApp(config, pool)
const server = app.listen(config.PORT, '0.0.0.0', () => console.log(`OrderLunch MCP listening on :${config.PORT}`))

async function shutdown() {
  server.close()
  await pool.end()
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
