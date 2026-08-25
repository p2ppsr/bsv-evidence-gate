import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { StorageDownloader, StorageUploader, WalletClient } from '@bsv/sdk'

const args = new Set(process.argv.slice(2))
const shouldPublish = args.has('--publish')
const shouldEstimate = args.has('--estimate') || !shouldPublish
const shouldUpdateConfig = args.has('--update-config')
const retentionMinutes = Number.parseInt(process.env.UHRP_RETENTION_MINUTES || '43200', 10)
const maxSats = Number.parseInt(process.env.MAX_UHRP_SATS || '0', 10)
const evidencePath = resolve('frontend/public/evidence/bodycam-demo.mp4.enc')
const configPath = resolve('frontend/public/demo-config.json')
const storageURLs = [
  'https://nanostore.babbage.systems',
  'https://bsv-storage-cloudflare.dev-a3e.workers.dev'
]

if (!Number.isInteger(retentionMinutes) || retentionMinutes < 60) {
  throw new Error('UHRP_RETENTION_MINUTES must be an integer of at least 60 minutes.')
}

const data = new Uint8Array(await readFile(evidencePath))
const wallet = new WalletClient('auto', 'localhost')
const uploader = new StorageUploader({ storageURLs, resilienceLevel: 1, wallet })
const estimate = await uploader.estimateCost({ fileSize: data.byteLength, retentionPeriod: retentionMinutes })

console.log(JSON.stringify({ mode: shouldPublish ? 'publish' : 'estimate', bytes: data.byteLength, retentionMinutes, estimate }, null, 2))

if (shouldEstimate && !shouldPublish) process.exit(0)
if (process.env.CONFIRM_BSV_SPEND !== 'YES') {
  throw new Error('Refusing paid upload: set CONFIRM_BSV_SPEND=YES after reviewing the quote.')
}
if (!Number.isInteger(maxSats) || maxSats <= 0 || estimate.totalForResilience > maxSats) {
  throw new Error(`Refusing paid upload: quoted ${estimate.totalForResilience} sats exceeds MAX_UHRP_SATS=${maxSats}.`)
}

const result = await uploader.publishFile({
  file: { data, type: 'application/octet-stream' },
  retentionPeriod: retentionMinutes
})
const downloaded = await new StorageDownloader({ networkPreset: 'mainnet' }).download(result.uhrpURL)
if (!downloaded.data || downloaded.data.length !== data.length) {
  throw new Error('UHRP round-trip validation returned the wrong byte length.')
}

if (shouldUpdateConfig) {
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  config.uhrpUrl = result.uhrpURL
  config.uhrpHost = result.hostedBy.join(', ')
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

console.log(JSON.stringify({ result, roundTripBytes: downloaded.data.length, configUpdated: shouldUpdateConfig }, null, 2))
