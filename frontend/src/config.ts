export type TransactionKey = 'capture' | 'storage' | 'request' | 'warrant' | 'view' | 'hold' | 'expiry'

export type EvidenceState = 'CAPTURED' | 'STORED' | 'ACCESS_REQUESTED' | 'AUTHORIZED' | 'VIEWED' | 'HELD' | 'EXPIRED'
export type EvidenceOutcome = 'held' | 'expired'

export interface EvidenceStateValue {
  schema: 'bsv-evidence-gate/1'
  evidenceId: string
  state: EvidenceState
  sequence: number
  event: TransactionKey
  actor: string
  occurredAt: string
  previousState: EvidenceState | null
  plaintextSha256?: string
  ciphertextSha256?: string
  uhrpUrl?: string
  retentionDeadline?: string
  authority?: string
}

export interface PublishedState {
  outpoint: string
  txid: string
  value: EvidenceStateValue
}

export interface EvidenceStateRecord {
  evidenceId: string
  outcome: EvidenceOutcome
  key: string
  currentOutpoint: string
  history: PublishedState[]
}

export interface GlobalKVStateProof {
  kind: 'GlobalKVStore'
  protocolID: [1 | 2, string]
  topic: 'tm_kvstore'
  service: 'ls_kvstore'
  lookupHost: string
  trackerHost: string
  controller: string
  records: Record<EvidenceOutcome, EvidenceStateRecord>
}

export interface DemoConfig {
  network: 'mainnet' | 'testnet'
  uhrpUrl: string
  uhrpHost: string
  explorerBaseUrl: string
  stateProof: GlobalKVStateProof
  legacyReceipts: Record<TransactionKey, string>
}

export const loadDemoConfig = async (): Promise<DemoConfig> => {
  const response = await fetch('/demo-config.json', { cache: 'no-store' })
  if (!response.ok) throw new Error('Could not load demo configuration')
  return response.json() as Promise<DemoConfig>
}
