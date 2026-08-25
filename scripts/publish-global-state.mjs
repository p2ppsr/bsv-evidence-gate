import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { GlobalKVStore, Transaction, WalletClient } from '@bsv/sdk'

const configPath = resolve('frontend/public/demo-config.json')
const evidenceModulePath = resolve('frontend/src/demoEvidence.generated.ts')
const publish = process.argv.includes('--publish')
const plan = process.argv.includes('--plan') || !publish
const maxSats = Number.parseInt(process.env.MAX_STATE_SATS || '0', 10)
const maxWrites = Number.parseInt(process.env.MAX_STATE_WRITES || '0', 10)
const conservativeSatsPerWrite = 1500

const evidenceModule = await readFile(evidenceModulePath, 'utf8')
const plaintextSha256 = evidenceModule.match(/"plaintextSha256": "([0-9a-f]{64})"/)?.[1]
const ciphertextSha256 = evidenceModule.match(/"ciphertextSha256": "([0-9a-f]{64})"/)?.[1]
if (!plaintextSha256 || !ciphertextSha256) throw new Error('Unable to read generated evidence hashes.')

const config = JSON.parse(await readFile(configPath, 'utf8'))
const proof = config.stateProof
if (!proof || proof.kind !== 'GlobalKVStore') throw new Error('Missing GlobalKVStore proof configuration.')
if (!config.uhrpUrl) throw new Error('Publish the encrypted UHRP object before publishing state.')

const shared = {
  schema: 'bsv-evidence-gate/1',
  plaintextSha256,
  ciphertextSha256,
  uhrpUrl: config.uhrpUrl,
  retentionDeadline: '2026-09-01T21:14:08.000Z'
}

const buildChain = (record, terminalState, terminalEvent, terminalActor) => {
  const steps = [
    ['CAPTURED', 'capture', 'CAM-12', '2026-08-25T21:14:08.000Z'],
    ['STORED', 'storage', 'Evidence service', '2026-08-25T21:14:12.000Z'],
    ['ACCESS_REQUESTED', 'request', 'Officer Morgan', '2026-08-25T21:17:44.000Z'],
    ['AUTHORIZED', 'warrant', 'Judge Rivera', '2026-08-25T21:18:06.000Z'],
    ['VIEWED', 'view', 'Prosecutor Elena Park', '2026-08-25T21:19:31.000Z'],
    [terminalState, terminalEvent, terminalActor, terminalState === 'HELD' ? '2026-08-25T21:20:02.000Z' : '2026-09-01T21:14:08.000Z']
  ]
  return steps.map(([state, event, actor, occurredAt], sequence) => ({
    ...shared,
    evidenceId: record.evidenceId,
    state,
    sequence,
    event,
    actor,
    occurredAt,
    previousState: sequence === 0 ? null : steps[sequence - 1][0],
    ...(state === 'AUTHORIZED' ? { authority: 'Franklin County Digital Court · Case 26-481 · 30-minute window' } : {}),
    ...(state === 'HELD' ? { authority: 'Case 26-481 preservation order' } : {}),
    ...(state === 'EXPIRED' ? { authority: 'Retention policy completed; governed key retired' } : {})
  }))
}

const chains = {
  held: buildChain(proof.records.held, 'HELD', 'hold', 'Prosecutor Elena Park'),
  expired: buildChain(proof.records.expired, 'EXPIRED', 'expiry', 'Retention service')
}
const allValues = Object.values(chains).flat()
const valueBytes = allValues.map(value => Buffer.byteLength(JSON.stringify(value)))
const remainingWrites = Object.entries(chains).reduce((total, [outcome, values]) => {
  return total + Math.max(0, values.length - (proof.records[outcome].history?.length || 0))
}, 0)
const spendCeiling = remainingWrites * conservativeSatsPerWrite

if (plan) {
  console.log(JSON.stringify({
    protocolID: proof.protocolID,
    topic: proof.topic,
    records: Object.fromEntries(Object.entries(chains).map(([outcome, values]) => [outcome, {
      key: proof.records[outcome].key,
      states: values.map(value => value.state)
    }])),
    totalTransactions: allValues.length,
    remainingWrites,
    valueBytes: { min: Math.min(...valueBytes), max: Math.max(...valueBytes) },
    conservativeSpendCeilingSats: spendCeiling
  }, null, 2))
  if (!publish) process.exit(0)
}

if (process.env.CONFIRM_BSV_SPEND !== 'YES') {
  throw new Error('Refusing mainnet state publication: set CONFIRM_BSV_SPEND=YES after approval.')
}
if (!Number.isInteger(maxSats) || maxSats < spendCeiling) {
  throw new Error(`MAX_STATE_SATS must be at least the conservative ${spendCeiling}-sat ceiling for ${remainingWrites} writes.`)
}
if (!Number.isInteger(maxWrites) || maxWrites !== remainingWrites) {
  throw new Error(`MAX_STATE_WRITES must exactly equal the planned remaining write count (${remainingWrites}).`)
}

const wallet = new WalletClient('auto', 'localhost')
const [{ authenticated }, { network }, { publicKey: controller }] = await Promise.all([
  wallet.isAuthenticated({}),
  wallet.getNetwork({}),
  wallet.getPublicKey({ identityKey: true })
])
if (!authenticated || network !== 'mainnet') throw new Error('An authenticated mainnet BRC-100 wallet is required.')
if (proof.controller && proof.controller !== controller) throw new Error('Configured controller differs from the active wallet identity.')
proof.controller = controller

const signedBeefByTxid = new Map()
const capturingWallet = new Proxy(wallet, {
  get(target, property) {
    const original = target[property]
    if (typeof original !== 'function') return original
    if (property !== 'createAction' && property !== 'signAction') return original.bind(target)
    return async (...args) => {
      const result = await original.apply(target, args)
      if (result.tx) {
        const transaction = Transaction.fromAtomicBEEF(result.tx)
        signedBeefByTxid.set(transaction.id('hex'), result.tx)
      }
      return result
    }
  }
})

const store = new GlobalKVStore({
  wallet: capturingWallet,
  protocolID: proof.protocolID,
  serviceName: proof.service,
  tokenAmount: 1,
  topics: [proof.topic],
  networkPreset: 'mainnet',
  overlayBroadcast: true,
  hostOverrides: {
    [proof.service]: [proof.lookupHost],
    ls_ship: [proof.trackerHost]
  },
  tokenSetDescription: 'Create BSV evidence state',
  tokenUpdateDescription: 'Advance BSV evidence state'
})

const persist = async () => writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
const submitToPinnedOverlay = async (outpoint) => {
  const txid = outpoint.split('.')[0]
  const beef = signedBeefByTxid.get(txid)
  if (!beef) throw new Error(`Signed BEEF was not captured for ${txid}.`)
  const response = await fetch(`${proof.lookupHost}/submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      // The deployed overlay currently expects the legacy JSON-array header.
      'x-topics': JSON.stringify([proof.topic])
    },
    body: new Uint8Array(beef)
  })
  const responseText = await response.text()
  if (!response.ok) throw new Error(`Pinned overlay rejected ${txid}: ${response.status} ${responseText}`)
  const steak = JSON.parse(responseText)
  const instructions = steak[proof.topic]
  if (!instructions || (
    (instructions.outputsToAdmit?.length || 0) === 0 &&
    (instructions.coinsToRetain?.length || 0) === 0
  )) {
    throw new Error(`Pinned overlay did not acknowledge ${proof.topic} for ${txid}.`)
  }
}
const waitForHistory = async (record, expectedLength) => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const entry = await store.get({ key: record.key, controller }, { history: true, includeToken: true })
    if (entry && !Array.isArray(entry) && (entry.history?.length || 0) >= expectedLength) return entry
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000))
  }
  throw new Error(`Overlay did not expose ${expectedLength} states for ${record.evidenceId} in time.`)
}

let writes = 0
for (const [outcome, values] of Object.entries(chains)) {
  const record = proof.records[outcome]
  const live = await store.get({ key: record.key, controller }, { history: true, includeToken: true })
  const liveHistory = live && !Array.isArray(live) ? (live.history || []).map(value => JSON.parse(value)) : []
  for (let index = 0; index < liveHistory.length; index += 1) {
    if (JSON.stringify(liveHistory[index]) !== JSON.stringify(values[index])) {
      throw new Error(`Live ${record.evidenceId} history diverges at sequence ${index}; refusing to overwrite.`)
    }
  }
  record.history = record.history || []
  for (let index = liveHistory.length; index < values.length; index += 1) {
    if (writes >= maxWrites) throw new Error('Write-count ceiling reached.')
    const value = values[index]
    const outpoint = await store.set(record.key, JSON.stringify(value), {
      tags: ['bsv-evidence-gate', `outcome-${outcome}`, `state-${value.state.toLowerCase()}`]
    })
    writes += 1
    const txid = outpoint.split('.')[0]
    record.currentOutpoint = outpoint
    record.history[index] = { outpoint, txid, value }
    await persist()
    await submitToPinnedOverlay(outpoint)
    await waitForHistory(record, index + 1)
    console.log(`${record.evidenceId} ${value.state}: ${outpoint}`)
  }
  const verified = await waitForHistory(record, values.length)
  record.currentOutpoint = `${verified.token.txid}.${verified.token.outputIndex}`
}
await persist()
if (writes > 0) {
  const publishedTxids = Object.values(proof.records)
    .flatMap(record => record.history.map(item => item.txid))
  const { sendWithResults = [] } = await wallet.createAction({
    description: 'Finalize BSV evidence state batch',
    options: {
      sendWith: publishedTxids,
      acceptDelayedBroadcast: false,
      returnTXIDOnly: true
    }
  })
  const failed = sendWithResults.filter(result => result.status === 'failed')
  if (failed.length > 0) throw new Error(`Wallet failed to finalize ${failed.length} state transactions.`)
}
console.log(JSON.stringify({ controller, writes, spendCeilingSats: maxSats, records: proof.records }, null, 2))
