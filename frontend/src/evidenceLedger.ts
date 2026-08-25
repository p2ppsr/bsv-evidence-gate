import { GlobalKVStore, ProtoWallet, PushDrop, Transaction, Utils } from '@bsv/sdk'
import type {
  DemoConfig,
  EvidenceOutcome,
  EvidenceState,
  EvidenceStateRecord,
  EvidenceStateValue,
  GlobalKVStateProof
} from './config'

const EXPECTED_STATES: Record<EvidenceOutcome, EvidenceState[]> = {
  held: ['CAPTURED', 'STORED', 'ACCESS_REQUESTED', 'AUTHORIZED', 'VIEWED', 'HELD'],
  expired: ['CAPTURED', 'STORED', 'ACCESS_REQUESTED', 'AUTHORIZED', 'VIEWED', 'EXPIRED']
}

export interface VerifiedRecord {
  outcome: EvidenceOutcome
  evidenceId: string
  tipTxid: string
  tipOutpoint: string
  state: EvidenceState
  historyLength: number
}

export interface LedgerVerification {
  controller: string
  records: Record<EvidenceOutcome, VerifiedRecord>
  checkedAt: string
}

const parseValue = (value: string): EvidenceStateValue => {
  const parsed = JSON.parse(value) as EvidenceStateValue
  if (parsed.schema !== 'bsv-evidence-gate/1') throw new Error('Unexpected evidence state schema')
  return parsed
}

export const validateStateHistory = (
  record: Pick<EvidenceStateRecord, 'evidenceId' | 'outcome'>,
  values: EvidenceStateValue[]
): void => {
  const expected = EXPECTED_STATES[record.outcome]
  if (values.length !== expected.length) {
    throw new Error(`${record.evidenceId} has ${values.length} states; expected ${expected.length}`)
  }
  values.forEach((value, index) => {
    if (value.evidenceId !== record.evidenceId) throw new Error('Evidence ID changed within the state chain')
    if (value.sequence !== index) throw new Error(`Invalid sequence at ${value.state}`)
    if (value.state !== expected[index]) throw new Error(`Invalid transition to ${value.state}`)
    const expectedPrevious = index === 0 ? null : expected[index - 1]
    if (value.previousState !== expectedPrevious) throw new Error(`Broken previous-state link at ${value.state}`)
  })
}

const verifyCurrentTokenSignature = async (
  beef: number[],
  outputIndex: number,
  proof: GlobalKVStateProof,
  record: EvidenceStateRecord
): Promise<string> => {
  const transaction = Transaction.fromBEEF(beef)
  const decoded = PushDrop.decode(transaction.outputs[outputIndex].lockingScript)
  const fields = decoded.fields.slice()
  const signature = fields.pop()
  if (!signature || fields.length < 4) throw new Error('Malformed GlobalKVStore token')
  const protocolID = JSON.parse(Utils.toUTF8(fields[0])) as [1 | 2, string]
  const key = Utils.toUTF8(fields[1])
  const controller = Utils.toHex(fields[3])
  if (JSON.stringify(protocolID) !== JSON.stringify(proof.protocolID)) throw new Error('Protocol ID mismatch')
  if (key !== record.key) throw new Error('GlobalKVStore key mismatch')
  if (controller !== proof.controller) throw new Error('Controller identity mismatch')
  const { valid } = await new ProtoWallet('anyone').verifySignature({
    data: fields.flat(),
    signature,
    counterparty: controller,
    protocolID,
    keyID: key
  })
  if (!valid) throw new Error('Invalid PushDrop controller signature')
  return transaction.id('hex')
}

const verifyRecord = async (
  store: GlobalKVStore,
  proof: GlobalKVStateProof,
  record: EvidenceStateRecord
): Promise<VerifiedRecord> => {
  const entry = await store.get(
    { key: record.key, controller: proof.controller },
    { history: true, includeToken: true }
  )
  if (!entry || Array.isArray(entry) || !entry.token) throw new Error(`${record.evidenceId} was not found on the overlay`)
  if (entry.controller !== proof.controller) throw new Error('Overlay returned an unexpected controller')
  const history = (entry.history ?? []).map(parseValue)
  validateStateHistory(record, history)
  const current = parseValue(entry.value)
  const expectedTip = history.at(-1)
  if (!expectedTip || JSON.stringify(current) !== JSON.stringify(expectedTip)) throw new Error('Tip value does not match its history')
  const tipTxid = await verifyCurrentTokenSignature(
    entry.token.beef.toBinary(),
    entry.token.outputIndex,
    proof,
    record
  )
  const tipOutpoint = `${tipTxid}.${entry.token.outputIndex}`
  if (tipOutpoint !== record.currentOutpoint) throw new Error(`${record.evidenceId} tip differs from the published manifest`)
  return {
    outcome: record.outcome,
    evidenceId: record.evidenceId,
    tipTxid,
    tipOutpoint,
    state: current.state,
    historyLength: history.length
  }
}

export const verifyGlobalEvidenceLedger = async (config: DemoConfig): Promise<LedgerVerification> => {
  const proof = config.stateProof
  if (!proof.controller || !proof.records.held.currentOutpoint || !proof.records.expired.currentOutpoint) {
    throw new Error('GlobalKVStore state chains have not been published yet')
  }
  const store = new GlobalKVStore({
    protocolID: proof.protocolID,
    serviceName: proof.service,
    topics: [proof.topic],
    networkPreset: config.network,
    hostOverrides: {
      [proof.service]: [proof.lookupHost],
      ls_ship: [proof.trackerHost]
    }
  })
  const [held, expired] = await Promise.all([
    verifyRecord(store, proof, proof.records.held),
    verifyRecord(store, proof, proof.records.expired)
  ])
  return {
    controller: proof.controller,
    records: { held, expired },
    checkedAt: new Date().toISOString()
  }
}
