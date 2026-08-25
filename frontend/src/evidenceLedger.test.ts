import { describe, expect, it } from 'vitest'
import { validateStateHistory } from './evidenceLedger'
import type { EvidenceState, EvidenceStateValue } from './config'

const states: EvidenceState[] = ['CAPTURED', 'STORED', 'ACCESS_REQUESTED', 'AUTHORIZED', 'VIEWED', 'HELD']
const history = states.map((state, sequence): EvidenceStateValue => ({
  schema: 'bsv-evidence-gate/1',
  evidenceId: 'EV-TEST-HOLD',
  state,
  sequence,
  event: ['capture', 'storage', 'request', 'warrant', 'view', 'hold'][sequence] as EvidenceStateValue['event'],
  actor: 'demo',
  occurredAt: '2026-08-25T21:14:08.000Z',
  previousState: sequence === 0 ? null : states[sequence - 1]
}))

describe('EvidenceLedger transition verification', () => {
  it('accepts the complete held chain', () => {
    expect(() => validateStateHistory({ evidenceId: 'EV-TEST-HOLD', outcome: 'held' }, history)).not.toThrow()
  })

  it('rejects a skipped authorization transition', () => {
    const modified = history.filter(value => value.state !== 'AUTHORIZED')
    expect(() => validateStateHistory({ evidenceId: 'EV-TEST-HOLD', outcome: 'held' }, modified)).toThrow()
  })

  it('rejects evidence identity substitution', () => {
    const modified = history.map((value, index) => index === 3 ? { ...value, evidenceId: 'EV-SWAPPED' } : value)
    expect(() => validateStateHistory({ evidenceId: 'EV-TEST-HOLD', outcome: 'held' }, modified)).toThrow()
  })
})
