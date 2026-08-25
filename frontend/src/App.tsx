import { useEffect, useMemo, useRef, useState } from 'react'
import { DEMO_EVIDENCE } from './demoEvidence.generated'
import { loadDemoConfig, type DemoConfig, type TransactionKey } from './config'
import { decryptEvidence, sha256Hex, signWarrant, verifyWarrant, type SignedWarrant } from './demoCrypto'
import {
  ArrowIcon,
  ChainIcon,
  CheckIcon,
  ClockIcon,
  DatabaseIcon,
  ExternalIcon,
  EyeIcon,
  FingerprintIcon,
  LockIcon,
  PlayIcon,
  ScaleIcon,
  ShieldIcon
} from './icons'

type DemoState = 'sealed' | 'denied' | 'requested' | 'warranted' | 'open' | 'held' | 'expired'
type Role = 'Public' | 'Officer' | 'Judge' | 'Prosecutor' | 'Auditor'

interface TimelineEvent {
  key: TransactionKey
  title: string
  detail: string
  time: string
  actor: string
}

const INITIAL_EVENTS: TimelineEvent[] = [
  {
    key: 'capture',
    title: 'Capture committed',
    detail: 'Camera signature, plaintext hash, and seven-day policy anchored.',
    time: '21:14:08Z',
    actor: 'CAM-12'
  },
  {
    key: 'storage',
    title: 'Ciphertext published',
    detail: 'AES-256-GCM object advertised through UHRP by content hash.',
    time: '21:14:12Z',
    actor: 'Evidence service'
  }
]

const EVENT_BY_KEY: Record<Exclude<TransactionKey, 'capture' | 'storage'>, TimelineEvent> = {
  request: {
    key: 'request',
    title: 'Access requested',
    detail: 'Officer request recorded; footage remains sealed pending judicial authority.',
    time: '21:17:44Z',
    actor: 'Officer Morgan'
  },
  warrant: {
    key: 'warrant',
    title: 'Court order issued',
    detail: 'Judge signature grants one named prosecutor a 30-minute access window.',
    time: '21:18:06Z',
    actor: 'Judge Rivera'
  },
  view: {
    key: 'view',
    title: 'Authorized view',
    detail: 'Credential verified, ciphertext hash matched, and footage decrypted in memory.',
    time: '21:19:31Z',
    actor: 'Prosecutor Park'
  },
  hold: {
    key: 'hold',
    title: 'Evidence hold applied',
    detail: 'Retention state moved from ACTIVE to HELD before scheduled expiry.',
    time: '21:20:02Z',
    actor: 'Prosecutor Park'
  },
  expiry: {
    key: 'expiry',
    title: 'Access cryptographically expired',
    detail: 'Official hosting retired and the governed decryption authority destroyed.',
    time: '+7 days',
    actor: 'Retention service'
  }
}

const ROLE_META: Record<Role, { badge: string, description: string }> = {
  Public: { badge: 'No credentials', description: 'Can verify the audit trail, never view footage.' },
  Officer: { badge: 'Agency identity', description: 'Can request access, but cannot self-authorize.' },
  Judge: { badge: 'Court authority', description: 'Can issue a signed, time-limited court order.' },
  Prosecutor: { badge: 'Named grantee', description: 'Can decrypt only while the order is valid.' },
  Auditor: { badge: 'Read-only proof', description: 'Can verify hashes and lifecycle transactions.' }
}

const shortHash = (value: string, head = 9, tail = 7) => value ? `${value.slice(0, head)}…${value.slice(-tail)}` : 'pending launch'
const fileSize = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

const ActionButton = ({ children, onClick, busy, variant = 'primary' }: {
  children: React.ReactNode
  onClick: () => void
  busy?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
}) => (
  <button className={`action-button ${variant}`} onClick={onClick} disabled={busy}>
    {busy ? <span className="spinner" /> : null}
    <span>{children}</span>
    {!busy && variant === 'primary' ? <ArrowIcon /> : null}
  </button>
)

const TxLink = ({ txid, config, compact = false }: { txid: string, config: DemoConfig | null, compact?: boolean }) => {
  if (!txid || !config) return <span className={`tx-link pending ${compact ? 'compact' : ''}`}>prepared for mainnet</span>
  return (
    <a className={`tx-link ${compact ? 'compact' : ''}`} href={`${config.explorerBaseUrl}${txid}`} target="_blank" rel="noreferrer">
      {shortHash(txid)} <ExternalIcon />
    </a>
  )
}

const App = () => {
  const [config, setConfig] = useState<DemoConfig | null>(null)
  const [state, setState] = useState<DemoState>('sealed')
  const [role, setRole] = useState<Role>('Public')
  const [events, setEvents] = useState<TimelineEvent[]>(INITIAL_EVENTS)
  const [warrant, setWarrant] = useState<SignedWarrant | null>(null)
  const [videoUrl, setVideoUrl] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('Evidence is encrypted. No decryption authority has been granted.')
  const [verifierOpen, setVerifierOpen] = useState(false)
  const [verifiedPlaintextHash, setVerifiedPlaintextHash] = useState('')
  const [verifiedCiphertextHash, setVerifiedCiphertextHash] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    loadDemoConfig().then(setConfig).catch(() => setConfig(null))
    return () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }
  }, [])

  const addEvent = (key: Exclude<TransactionKey, 'capture' | 'storage'>) => {
    setEvents(current => current.some(event => event.key === key) ? current : [...current, EVENT_BY_KEY[key]])
  }

  const fetchCiphertext = async (): Promise<ArrayBuffer> => {
    if (config?.uhrpUrl) {
      const { StorageDownloader } = await import('@bsv/sdk')
      const downloader = new StorageDownloader({ networkPreset: config.network })
      const resolved = await downloader.download(config.uhrpUrl)
      if (!resolved.data) throw new Error('The UHRP object could not be resolved')
      return Uint8Array.from(resolved.data).buffer
    }
    const response = await fetch(DEMO_EVIDENCE.localCiphertextUrl)
    if (!response.ok) throw new Error('The encrypted evidence object could not be loaded')
    return response.arrayBuffer()
  }

  const attemptUnauthorizedAccess = async () => {
    setBusy(true)
    setRole('Officer')
    await new Promise(resolve => window.setTimeout(resolve, 650))
    setState('denied')
    setNotice('Access denied. Agency employment is not legal authority to inspect this footage.')
    setBusy(false)
  }

  const requestAccess = async () => {
    setBusy(true)
    await new Promise(resolve => window.setTimeout(resolve, 500))
    addEvent('request')
    setState('requested')
    setRole('Judge')
    setNotice('Request recorded. Only the designated court authority can authorize release.')
    setBusy(false)
  }

  const issueWarrant = async () => {
    setBusy(true)
    const issuedAt = new Date()
    const expiresAt = new Date(issuedAt.getTime() + 30 * 60 * 1000)
    const signed = await signWarrant({
      evidenceId: 'EV-2026-1042',
      purpose: 'Case 26-481 limited evidentiary review',
      grantee: 'Prosecutor Elena Park',
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      court: 'Franklin County Digital Court'
    })
    setWarrant(signed)
    addEvent('warrant')
    setState('warranted')
    setRole('Prosecutor')
    setNotice('Signed order verified. One named prosecutor has a 30-minute access window.')
    setBusy(false)
  }

  const openEvidence = async () => {
    if (!warrant) return
    setBusy(true)
    try {
      if (!(await verifyWarrant(warrant))) throw new Error('Court signature verification failed')
      const ciphertext = await fetchCiphertext()
      const ciphertextHash = await sha256Hex(ciphertext)
      if (ciphertextHash !== DEMO_EVIDENCE.ciphertextSha256) throw new Error('Ciphertext hash does not match its evidence manifest')
      const plaintext = await decryptEvidence(ciphertext, DEMO_EVIDENCE.keyBase64, DEMO_EVIDENCE.ivBase64)
      const plaintextHash = await sha256Hex(plaintext)
      if (plaintextHash !== DEMO_EVIDENCE.plaintextSha256) throw new Error('Decrypted footage hash does not match its capture commitment')
      if (videoUrl) URL.revokeObjectURL(videoUrl)
      const nextVideoUrl = URL.createObjectURL(new Blob([plaintext], { type: 'video/mp4' }))
      setVideoUrl(nextVideoUrl)
      setVerifiedCiphertextHash(ciphertextHash)
      setVerifiedPlaintextHash(plaintextHash)
      addEvent('view')
      setState('open')
      setNotice('Authorized. Both hashes match; decrypted bytes exist only in this browser session.')
      window.setTimeout(() => videoRef.current?.play().catch(() => {}), 120)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to verify and decrypt evidence')
    } finally {
      setBusy(false)
    }
  }

  const applyHold = () => {
    addEvent('hold')
    setState('held')
    setRole('Auditor')
    setNotice('Evidence hold applied. The UHRP hosting commitment can now be renewed under the signed case authority.')
  }

  const expireEvidence = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl('')
    addEvent('expiry')
    setState('expired')
    setRole('Auditor')
    setNotice('Access expired. Official hosting is retired and governed decryption authority is destroyed.')
  }

  const resetDemo = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl('')
    setState('sealed')
    setRole('Public')
    setEvents(INITIAL_EVENTS)
    setWarrant(null)
    setVerifiedCiphertextHash('')
    setVerifiedPlaintextHash('')
    setNotice('Evidence is encrypted. No decryption authority has been granted.')
  }

  const nextAction = useMemo(() => {
    if (state === 'sealed') return { label: 'Try access as an officer', action: attemptUnauthorizedAccess }
    if (state === 'denied') return { label: 'File a court access request', action: requestAccess }
    if (state === 'requested') return { label: 'Issue a signed court order', action: issueWarrant }
    if (state === 'warranted') return { label: 'Verify order & decrypt footage', action: openEvidence }
    return null
  }, [state, warrant, config])

  const stateLabel: Record<DemoState, string> = {
    sealed: 'Encrypted · sealed',
    denied: 'Access denied',
    requested: 'Judicial review',
    warranted: 'Court-authorized',
    open: 'Verified session',
    held: 'Evidence hold',
    expired: 'Cryptographically expired'
  }

  const retentionPercent = state === 'expired' ? 100 : state === 'held' ? 38 : state === 'open' ? 76 : 24

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="BSV Evidence Gate home">
          <span className="brand-mark"><ShieldIcon /></span>
          <span><strong>BSV</strong> Evidence Gate</span>
        </a>
        <nav>
          <a href="#demo">Live scenario</a>
          <a href="#architecture">How it works</a>
          <button className="text-button" onClick={() => setVerifierOpen(true)}>Public verifier</button>
        </nav>
        <div className="network-pill"><span /> BSV {config?.network ?? 'mainnet'}</div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> A working privacy model for public evidence</div>
            <h1>Privacy without<br /><em>blind spots.</em></h1>
            <p className="hero-lede">Body-camera footage stays encrypted. Courts authorize narrow access. BSV makes every lifecycle decision independently auditable.</p>
            <div className="hero-actions">
              <a className="action-button primary" href="#demo"><PlayIcon /><span>Run the 90-second demo</span><ArrowIcon /></a>
              <button className="action-button secondary" onClick={() => setVerifierOpen(true)}><ChainIcon /><span>Inspect the proof</span></button>
            </div>
            <div className="hero-proof">
              <div><strong>AES-256</strong><span>encrypted before upload</span></div>
              <div><strong>UHRP</strong><span>content-addressed storage</span></div>
              <div><strong>BSV</strong><span>tamper-evident audit trail</span></div>
            </div>
          </div>
          <div className="hero-visual" aria-label="Synthetic body camera evidence preview">
            <img src="/evidence/bodycam-frame.png" alt="Synthetic body-camera view of a vehicle stopped on a quiet road at dusk" />
            <div className="camera-topline"><span><i /> REC</span><span>SYNTHETIC DEMO · NOT REAL EVIDENCE</span></div>
            <div className="camera-meta"><span>CAM-12</span><span>2026-08-25 21:14:07Z</span></div>
            <div className="seal-card">
              <span className="seal-icon"><LockIcon /></span>
              <div><strong>Sealed at capture</strong><span>Key unavailable without valid authority</span></div>
              <span className="check"><CheckIcon /></span>
            </div>
            <div className="visual-glow" />
          </div>
        </section>

        <section className="trust-strip">
          <span>One clip. Four institutions. Zero silent access.</span>
          <div className="trust-line" />
          <span className="trust-status"><i /> Live cryptographic demonstration</span>
        </section>

        <section className="demo-section" id="demo">
          <div className="section-heading">
            <div><span className="section-number">01</span><span className="eyebrow">Guided scenario</span></div>
            <h2>Can a legitimate investigation proceed<br />without building a surveillance free-for-all?</h2>
            <p>Step through the same evidence as each participant. The cryptography is real; the identities and footage are fictional.</p>
          </div>

          <div className="role-switcher" aria-label="Current demo role">
            {(Object.keys(ROLE_META) as Role[]).map(item => (
              <button key={item} className={role === item ? 'active' : ''} onClick={() => setRole(item)}>
                <span>{item.slice(0, 1)}</span>{item}
              </button>
            ))}
          </div>

          <div className="scenario-grid">
            <article className="evidence-panel">
              <div className="panel-header">
                <div>
                  <span className="record-kicker">Evidence record</span>
                  <h3>EV-2026-1042</h3>
                </div>
                <span className={`state-badge ${state}`}><i /> {stateLabel[state]}</span>
              </div>

              <div className={`video-stage ${state === 'expired' ? 'is-expired' : ''}`}>
                {videoUrl && state !== 'expired' ? (
                  <video ref={videoRef} src={videoUrl} poster="/evidence/bodycam-frame.png" controls playsInline />
                ) : (
                  <img src="/evidence/bodycam-frame.png" alt="Encrypted synthetic evidence preview" />
                )}
                <div className="video-overlay-top"><span><i /> REC</span><span>SYNTHETIC DEMO · NOT REAL EVIDENCE</span></div>
                {!videoUrl && state !== 'expired' ? (
                  <div className="locked-overlay"><LockIcon /><strong>Encrypted evidence</strong><span>A valid signed order is required to release the key</span></div>
                ) : null}
                {state === 'expired' ? (
                  <div className="locked-overlay expired-overlay"><ClockIcon /><strong>Access expired</strong><span>UHRP commitment retired · governed key destroyed</span></div>
                ) : null}
              </div>

              <div className="notice-row">
                <span className={`notice-icon ${state}`}><ShieldIcon /></span>
                <p>{notice}</p>
              </div>

              <div className="identity-card">
                <div className="avatar">{role.slice(0, 1)}</div>
                <div><span>You are viewing as</span><strong>{role}</strong><small>{ROLE_META[role].description}</small></div>
                <span className="credential-badge">{ROLE_META[role].badge}</span>
              </div>

              {nextAction ? (
                <ActionButton onClick={nextAction.action} busy={busy}>{nextAction.label}</ActionButton>
              ) : null}
              {state === 'open' ? (
                <div className="split-actions">
                  <ActionButton onClick={applyHold}>Place evidence hold</ActionButton>
                  <ActionButton onClick={expireEvidence} variant="danger">Run seven-day expiry</ActionButton>
                </div>
              ) : null}
              {(state === 'held' || state === 'expired') ? (
                <ActionButton onClick={resetDemo} variant="secondary">Reset guided scenario</ActionButton>
              ) : null}
            </article>

            <aside className="ledger-panel">
              <div className="panel-header ledger-heading">
                <div><span className="record-kicker">Independent record</span><h3>BSV audit trail</h3></div>
                <span className="live-dot"><i /> LIVE</span>
              </div>
              <div className="timeline">
                {events.map((event, index) => {
                  const txid = config?.transactions[event.key] ?? ''
                  return (
                    <div className="timeline-event" key={event.key}>
                      <span className="timeline-marker"><CheckIcon /></span>
                      <div className="timeline-content">
                        <div><strong>{event.title}</strong><time>{event.time}</time></div>
                        <p>{event.detail}</p>
                        <div className="event-meta"><span>{event.actor}</span><TxLink txid={txid} config={config} compact /></div>
                      </div>
                      {index < events.length - 1 ? <span className="timeline-rail" /> : null}
                    </div>
                  )
                })}
              </div>

              <button className="verify-button" onClick={() => setVerifierOpen(true)}>
                <FingerprintIcon />
                <span><strong>Verify this record yourself</strong><small>Recompute hashes and inspect every BSV transaction</small></span>
                <ArrowIcon />
              </button>
            </aside>
          </div>
        </section>

        <section className="retention-section">
          <div className="retention-copy">
            <span className="section-number">02</span>
            <span className="eyebrow">Retention without trust</span>
            <h2>Seven days means<br /><em>seven days.</em></h2>
            <p>The policy is committed at capture. Before expiry, an authorized evidence hold can renew availability. Without one, official UHRP hosting retires and decryption authority is destroyed.</p>
            <div className="honesty-note"><ShieldIcon /><span><strong>An honest security boundary.</strong> Blockchain proves the governed system’s actions. Key destruction makes retained ciphertext unusable; no network can prove a rogue third party kept no copy.</span></div>
          </div>
          <div className="retention-card">
            <div className="retention-top"><span>DEMO RETENTION CLOCK</span><strong>{state === 'expired' ? 'EXPIRED' : state === 'held' ? 'ON HOLD' : '6d 23h 42m'}</strong></div>
            <div className="retention-track"><span style={{ width: `${retentionPercent}%` }} /></div>
            <div className="retention-labels"><span>CAPTURED</span><span>7-DAY DEADLINE</span></div>
            <div className="policy-paths">
              <div className={state === 'held' ? 'selected' : ''}><span className="path-icon hold"><ScaleIcon /></span><div><strong>Legal hold arrives</strong><p>Signed authority spends the active evidence state into a renewed HELD state.</p></div><CheckIcon /></div>
              <div className={state === 'expired' ? 'selected expired' : ''}><span className="path-icon expire"><ClockIcon /></span><div><strong>No hold arrives</strong><p>Hosting expires, key authority is retired, and the expiry receipt is anchored.</p></div><CheckIcon /></div>
            </div>
          </div>
        </section>

        <section className="architecture-section" id="architecture">
          <div className="section-heading compact-heading">
            <div><span className="section-number">03</span><span className="eyebrow">The architecture</span></div>
            <h2>Store the footage. Prove the rules.</h2>
            <p>Each layer does one job, so privacy does not depend on a database administrator’s promises.</p>
          </div>
          <div className="architecture-grid">
            <div className="architecture-card"><span><LockIcon /></span><small>01 · AT CAPTURE</small><h3>Encrypt first</h3><p>A unique AES-256-GCM key seals each recording before any storage host receives it.</p><code>{shortHash(DEMO_EVIDENCE.plaintextSha256, 12, 8)}</code></div>
            <div className="architecture-connector"><ArrowIcon /></div>
            <div className="architecture-card"><span><DatabaseIcon /></span><small>02 · UHRP</small><h3>Store by hash</h3><p>Only ciphertext is published. Content addressing detects modification and enables resilient resolution.</p><code>{shortHash(DEMO_EVIDENCE.ciphertextSha256, 12, 8)}</code></div>
            <div className="architecture-connector"><ArrowIcon /></div>
            <div className="architecture-card"><span><ChainIcon /></span><small>03 · BSV</small><h3>Prove every decision</h3><p>Capture, authority, access, holds, and expiry form a public, tamper-evident lifecycle.</p><code>{events.length} lifecycle events</code></div>
          </div>
        </section>

        <section className="closing-section">
          <div><span className="eyebrow">Built as a response to a real question</span><h2>Useful evidence systems<br />do not require silent surveillance.</h2></div>
          <button className="action-button light" onClick={resetDemo}><PlayIcon /><span>Run the demo again</span><ArrowIcon /></button>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark"><ShieldIcon /></span><span><strong>BSV</strong> Evidence Gate</span></div>
        <p>Open proof-of-concept · Fictional identities · Synthetic footage · Not a production evidence system</p>
        <div><a href="https://github.com/p2ppsr/bsv-evidence-gate" target="_blank" rel="noreferrer">Source <ExternalIcon /></a><a href="https://bsv.brc.dev/overlays/0026" target="_blank" rel="noreferrer">UHRP standard <ExternalIcon /></a></div>
      </footer>

      {verifierOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setVerifierOpen(false)}>
          <section className="verifier-modal" role="dialog" aria-modal="true" aria-labelledby="verifier-title" onMouseDown={event => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setVerifierOpen(false)} aria-label="Close verifier">×</button>
            <span className="verifier-mark"><FingerprintIcon /></span>
            <span className="eyebrow">Public verifier</span>
            <h2 id="verifier-title">Trust the bytes, not the interface.</h2>
            <p>These commitments let any investigator, defense attorney, court, or citizen detect changes to the official evidence record.</p>
            <div className="verification-list">
              <div><span><CheckIcon /></span><section><small>CAPTURE COMMITMENT · SHA-256</small><code>{DEMO_EVIDENCE.plaintextSha256}</code><p>{verifiedPlaintextHash ? 'Recomputed from the decrypted video in this browser — match.' : 'Committed before encryption; recomputed whenever authorized footage opens.'}</p></section></div>
              <div><span><CheckIcon /></span><section><small>UHRP CIPHERTEXT · SHA-256</small><code>{DEMO_EVIDENCE.ciphertextSha256}</code><p>{verifiedCiphertextHash ? 'Recomputed from the resolved ciphertext in this browser — match.' : `${fileSize(DEMO_EVIDENCE.ciphertextBytes)} encrypted object · ${config?.uhrpHost ?? 'UHRP host'}`}</p></section></div>
              <div><span className={warrant ? '' : 'muted'}>{warrant ? <CheckIcon /> : <ClockIcon />}</span><section><small>COURT CREDENTIAL</small><code>{warrant ? shortHash(warrant.signatureBase64, 18, 12) : 'Run the guided scenario to issue'}</code><p>{warrant ? `${warrant.algorithm} signature issued to ${warrant.payload.grantee}.` : 'No order exists in this browser session yet.'}</p></section></div>
            </div>
            <div className="transaction-grid">
              {events.map(event => <div key={event.key}><span>{event.title}</span><TxLink txid={config?.transactions[event.key] ?? ''} config={config} /></div>)}
            </div>
            <button className="action-button primary modal-action" onClick={() => setVerifierOpen(false)}><CheckIcon /><span>Verification complete</span></button>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default App
