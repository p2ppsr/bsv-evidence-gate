import { describe, expect, it } from 'vitest'
import { canonicalWarrant, signWarrant, verifyWarrant, type WarrantPayload } from './demoCrypto'

const payload: WarrantPayload = {
  evidenceId: 'EV-2026-1042',
  purpose: 'Case 26-481 discovery',
  grantee: 'Prosecutor Elena Park',
  issuedAt: '2026-08-25T21:18:00.000Z',
  expiresAt: '2026-08-25T21:48:00.000Z',
  court: 'Franklin County Digital Court'
}

describe('court-order credentials', () => {
  it('canonicalizes fields independently of insertion order', () => {
    expect(canonicalWarrant(payload)).toBe('{"court":"Franklin County Digital Court","evidenceId":"EV-2026-1042","expiresAt":"2026-08-25T21:48:00.000Z","grantee":"Prosecutor Elena Park","issuedAt":"2026-08-25T21:18:00.000Z","purpose":"Case 26-481 discovery"}')
  })

  it('verifies the signed payload and rejects a modified payload', async () => {
    const signed = await signWarrant(payload)
    expect(await verifyWarrant(signed)).toBe(true)
    expect(await verifyWarrant({
      ...signed,
      payload: { ...signed.payload, grantee: 'Someone else' }
    })).toBe(false)
  })
})
