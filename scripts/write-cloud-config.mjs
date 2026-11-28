import { writeFile } from 'node:fs/promises'
import { connectionOrigin } from '../dist/main/ear-api.js'

const value = process.env.EAR_DESKTOP_API_URL?.trim()
const origin = value ? connectionOrigin(value) : null
await writeFile(new URL('../dist/main/ear-cloud.json', import.meta.url), JSON.stringify({ origin }))

if (value && origin === null) {
  throw new Error('EAR_DESKTOP_API_URL must be an HTTPS origin without credentials, a path, a query, or a fragment.')
}
