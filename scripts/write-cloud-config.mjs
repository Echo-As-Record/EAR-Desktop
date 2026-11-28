import { writeFile } from 'node:fs/promises'
import { connectionOrigin } from '../dist/main/ear-api.js'

function configuredOrigin(name) {
  const value = process.env[name]?.trim()
  const origin = value ? connectionOrigin(value) : null
  if (value && origin === null) {
    throw new Error(name + ' must be an HTTPS origin without credentials, a path, a query, or a fragment.')
  }
  return origin
}

const origin = configuredOrigin('EAR_DESKTOP_API_URL')
const ingestOrigin = configuredOrigin('EAR_DESKTOP_INGEST_URL')
await writeFile(new URL('../dist/main/ear-cloud.json', import.meta.url), JSON.stringify({ origin, ingestOrigin }))
