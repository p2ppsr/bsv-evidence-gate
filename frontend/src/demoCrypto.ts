export interface WarrantPayload {
  evidenceId: string
  purpose: string
  grantee: string
  issuedAt: string
  expiresAt: string
  court: string
}

export interface SignedWarrant {
  payload: WarrantPayload
  signatureBase64: string
  publicKey: JsonWebKey
  algorithm: 'ECDSA-P256-SHA256'
}

const textEncoder = new TextEncoder()

const asArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer

export const bytesFromBase64 = (value: string): Uint8Array => {
  const binary = globalThis.atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export const base64FromBytes = (value: ArrayBuffer | Uint8Array): string => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return globalThis.btoa(binary)
}

export const sha256Hex = async (value: ArrayBuffer | Uint8Array): Promise<string> => {
  const input = value instanceof Uint8Array ? value : new Uint8Array(value)
  const digest = await crypto.subtle.digest('SHA-256', asArrayBuffer(input))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export const canonicalWarrant = (payload: WarrantPayload): string => JSON.stringify({
  court: payload.court,
  evidenceId: payload.evidenceId,
  expiresAt: payload.expiresAt,
  grantee: payload.grantee,
  issuedAt: payload.issuedAt,
  purpose: payload.purpose
})

export const signWarrant = async (payload: WarrantPayload): Promise<SignedWarrant> => {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    textEncoder.encode(canonicalWarrant(payload))
  )
  return {
    payload,
    signatureBase64: base64FromBytes(signature),
    publicKey: await crypto.subtle.exportKey('jwk', keyPair.publicKey),
    algorithm: 'ECDSA-P256-SHA256'
  }
}

export const verifyWarrant = async (warrant: SignedWarrant): Promise<boolean> => {
  const key = await crypto.subtle.importKey(
    'jwk',
    warrant.publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    asArrayBuffer(bytesFromBase64(warrant.signatureBase64)),
    textEncoder.encode(canonicalWarrant(warrant.payload))
  )
}

export const decryptEvidence = async (
  ciphertext: ArrayBuffer,
  keyBase64: string,
  ivBase64: string
): Promise<ArrayBuffer> => {
  const key = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(bytesFromBase64(keyBase64)),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(bytesFromBase64(ivBase64)) },
    key,
    ciphertext
  )
}
