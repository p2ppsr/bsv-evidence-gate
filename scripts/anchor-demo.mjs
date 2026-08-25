import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LockingScript, Utils, WalletClient } from '@bsv/sdk'

const configPath = resolve('frontend/public/demo-config.json')
const evidenceModulePath = resolve('frontend/src/demoEvidence.generated.ts')
const maxSats = Number.parseInt(process.env.MAX_ANCHOR_SATS || '0', 10)

if (process.env.CONFIRM_BSV_SPEND !== 'YES') {
  throw new Error('Refusing mainnet anchors: set CONFIRM_BSV_SPEND=YES and MAX_ANCHOR_SATS after approval.')
}
if (!Number.isInteger(maxSats) || maxSats <= 0) {
  throw new Error('MAX_ANCHOR_SATS must be a positive integer.')
}

const evidenceModule = await readFile(evidenceModulePath, 'utf8')
const plaintextSha256 = evidenceModule.match(/"plaintextSha256": "([0-9a-f]{64})"/)?.[1]
const ciphertextSha256 = evidenceModule.match(/"ciphertextSha256": "([0-9a-f]{64})"/)?.[1]
if (!plaintextSha256 || !ciphertextSha256) throw new Error('Unable to read generated evidence hashes.')

const config = JSON.parse(await readFile(configPath, 'utf8'))
if (!config.uhrpUrl) throw new Error('Publish the encrypted UHRP object before anchoring the scenario.')

const scenario = {
  capture: { actor: 'CAM-12', policy: 'expire-after-7-days', plaintextSha256 },
  storage: { actor: 'Evidence service', ciphertextSha256, uhrpUrl: config.uhrpUrl },
  request: { actor: 'Officer Morgan', authority: 'requested-not-granted' },
  warrant: { actor: 'Judge Rivera', grantee: 'Prosecutor Elena Park', windowMinutes: 30 },
  view: { actor: 'Prosecutor Elena Park', checks: ['court-signature', 'ciphertext-hash', 'plaintext-hash'] },
  hold: { actor: 'Prosecutor Elena Park', state: 'held-under-case-authority' },
  expiry: { actor: 'Retention service', state: 'official-hosting-and-key-retired' }
}

const wallet = new WalletClient('auto', 'localhost')
const { authenticated } = await wallet.isAuthenticated({})
const { network } = await wallet.getNetwork({})
if (!authenticated || network !== 'mainnet') throw new Error('An authenticated mainnet BRC-100 wallet is required.')

const results = { ...config.transactions }
let outputSatoshis = 0
for (const [event, detail] of Object.entries(scenario)) {
  if (results[event]) continue
  const payload = JSON.stringify({ p: 'BSVEG/1', evidence: 'EV-2026-1042', event, detail })
  const payloadHex = Utils.toHex(Utils.toArray(payload, 'utf8'))
  const lockingScript = LockingScript.fromASM(`OP_FALSE OP_RETURN ${payloadHex}`).toHex()
  outputSatoshis += 1
  if (outputSatoshis > maxSats) throw new Error(`Anchor output budget exceeds MAX_ANCHOR_SATS=${maxSats}.`)
  const result = await wallet.createAction({
    description: `Anchor evidence ${event}`,
    labels: ['bsv-evidence-gate', `evidence-${event}`],
    outputs: [{ lockingScript, satoshis: 1, outputDescription: `Evidence ${event} marker` }],
    options: { randomizeOutputs: false }
  })
  if (!result.txid) throw new Error(`Wallet returned no TXID for ${event}.`)
  results[event] = result.txid
  config.transactions = results
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

console.log(JSON.stringify({ protocol: 'BSVEG/1', transactions: results, outputSatoshis }, null, 2))
