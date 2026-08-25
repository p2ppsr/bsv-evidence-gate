import { useEffect, useRef, useState } from 'react'
import { DEMO_EVIDENCE } from './demoEvidence.generated'
import { loadDemoConfig, type DemoConfig, type EvidenceOutcome, type TransactionKey } from './config'
import { decryptEvidence, sha256Hex, signWarrant, verifyWarrant, type SignedWarrant } from './demoCrypto'
import { verifyGlobalEvidenceLedger, type LedgerVerification } from './evidenceLedger'
import {
  ArrowIcon,
  ChainIcon,
  CheckIcon,
  ClockIcon,
  DatabaseIcon,
  ExternalIcon,
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
    title: 'Video captured',
    detail: 'The camera signed the video fingerprint and seven-day rule.',
    time: '21:14:08Z',
    actor: 'CAM-12'
  },
  {
    key: 'storage',
    title: 'Encrypted copy stored',
    detail: 'The encrypted video was stored under its unique digital fingerprint.',
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
    detail: 'Court order, encrypted-file fingerprint, and video fingerprint all matched.',
    time: '21:19:31Z',
    actor: 'Prosecutor Park'
  },
  hold: {
    key: 'hold',
    title: 'Evidence hold applied',
    detail: 'A signed hold paused the seven-day clock before the video expired.',
    time: '21:20:02Z',
    actor: 'Prosecutor Park'
  },
  expiry: {
    key: 'expiry',
    title: 'Access expired',
    detail: 'The official copy was removed and its unlocking key was destroyed.',
    time: '+7 days',
    actor: 'Retention service'
  }
}

const ROLE_META: Record<Role, { badge: string, description: string }> = {
  Public: { badge: 'No credentials', description: 'Can verify the public record, but cannot view the footage.' },
  Officer: { badge: 'Agency identity', description: 'Can request access, but cannot self-authorize.' },
  Judge: { badge: 'Court authority', description: 'Can issue a signed, time-limited court order.' },
  Prosecutor: { badge: 'Named person', description: 'Can open the video only while the order is valid.' },
  Auditor: { badge: 'Read-only proof', description: 'Can check the video fingerprints and the full public history.' }
}

const shortHash = (value: string, head = 9, tail = 7) => value ? `${value.slice(0, head)}…${value.slice(-tail)}` : 'pending launch'
const fileSize = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

const ActionButton = ({ children, onClick, busy, variant = 'primary' }: {
  children: React.ReactNode
  onClick: () => void
  busy?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
}) => (
  <button type="button" className={`action-button ${variant}`} onClick={onClick} disabled={busy}>
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
  const [notice, setNotice] = useState('The video is locked. No court has granted access.')
  const [verifierOpen, setVerifierOpen] = useState(false)
  const [verifiedPlaintextHash, setVerifiedPlaintextHash] = useState('')
  const [verifiedCiphertextHash, setVerifiedCiphertextHash] = useState('')
  const [ledgerVerification, setLedgerVerification] = useState<LedgerVerification | null>(null)
  const [ledgerError, setLedgerError] = useState('')
  const [ledgerChecking, setLedgerChecking] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    loadDemoConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])

  useEffect(() => {
    if (!verifierOpen) return
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setVerifierOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    return () => {
      document.body.style.overflow = priorOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [verifierOpen])

  useEffect(() => {
    if (!verifierOpen || !config) return
    let active = true
    setLedgerChecking(true)
    setLedgerVerification(null)
    setLedgerError('')
    verifyGlobalEvidenceLedger(config)
      .then(result => { if (active) setLedgerVerification(result) })
      .catch(error => { if (active) setLedgerError(error instanceof Error ? error.message : 'Overlay verification failed') })
      .finally(() => { if (active) setLedgerChecking(false) })
    return () => { active = false }
  }, [verifierOpen, config])

  const addEvent = (key: Exclude<TransactionKey, 'capture' | 'storage'>) => {
    setEvents(current => current.some(event => event.key === key) ? current : [...current, EVENT_BY_KEY[key]])
  }

  const fetchCiphertext = async (): Promise<ArrayBuffer> => {
    if (config?.uhrpUrl) {
      const { StorageDownloader } = await import('@bsv/sdk')
      const downloader = new StorageDownloader({ networkPreset: config.network })
      const resolved = await downloader.download(config.uhrpUrl)
      if (!resolved.data) throw new Error('The encrypted video could not be retrieved')
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
      if (ciphertextHash !== DEMO_EVIDENCE.ciphertextSha256) throw new Error('The stored file does not match its recorded fingerprint')
      const plaintext = await decryptEvidence(ciphertext, DEMO_EVIDENCE.keyBase64, DEMO_EVIDENCE.ivBase64)
      const plaintextHash = await sha256Hex(plaintext)
      if (plaintextHash !== DEMO_EVIDENCE.plaintextSha256) throw new Error('The opened video does not match the camera’s original fingerprint')
      if (videoUrl) URL.revokeObjectURL(videoUrl)
      const nextVideoUrl = URL.createObjectURL(new Blob([plaintext], { type: 'video/mp4' }))
      setVideoUrl(nextVideoUrl)
      setVerifiedCiphertextHash(ciphertextHash)
      setVerifiedPlaintextHash(plaintextHash)
      addEvent('view')
      setState('open')
      setNotice('Authorized. Both digital fingerprints match; the unlocked video exists only in this browser session.')
      window.setTimeout(() => videoRef.current?.play().catch(() => {}), 120)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The video could not be checked and opened')
    } finally {
      setBusy(false)
    }
  }

  const applyHold = () => {
    addEvent('hold')
    setState('held')
    setRole('Auditor')
    setNotice('Evidence hold applied. The video will stay available because the signed hold requires it.')
  }

  const expireEvidence = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl('')
    addEvent('expiry')
    setState('expired')
    setRole('Auditor')
    setNotice('Seven days passed without a hold. The public record shows that access expired, and the official unlocking key is gone.')
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
    setNotice('The video is locked. No court has granted access.')
  }

  const nextAction = (() => {
    if (state === 'sealed') return { label: 'Try access as an officer', action: attemptUnauthorizedAccess }
    if (state === 'denied') return { label: 'File a court access request', action: requestAccess }
    if (state === 'requested') return { label: 'Issue a signed court order', action: issueWarrant }
    if (state === 'warranted') return { label: 'Check order and open video', action: openEvidence }
    return null
  })()

  const stateLabel: Record<DemoState, string> = {
    sealed: 'Encrypted · sealed',
    denied: 'Access denied',
    requested: 'Judicial review',
    warranted: 'Court-authorized',
    open: 'Verified session',
    held: 'Evidence hold',
    expired: 'Access expired'
  }

  const retentionPercent = state === 'expired' ? 100 : state === 'held' ? 38 : state === 'open' ? 76 : 24
  const activeOutcome: EvidenceOutcome = state === 'expired' ? 'expired' : 'held'
  const activeRecord = config?.stateProof.records[activeOutcome]
  const transactionForEvent = (event: TransactionKey) => activeRecord?.history.find(item => item.value.event === event)?.txid ?? ''

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
          <button type="button" className="text-button" onClick={() => setVerifierOpen(true)}>Verify the record</button>
        </nav>
        <div className="network-pill"><span /> BSV live</div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> Privacy-first public evidence</div>
            <h1>Safer evidence.<br /><em>Stronger rights.</em></h1>
            <p className="hero-lede">Body-camera footage stays locked. A court can grant narrow, time-limited access. Every decision leaves a signed public record on BSV that anyone can check.</p>
            <div className="hero-actions">
              <a className="action-button primary" href="#demo"><PlayIcon /><span>Run the 90-second demo</span><ArrowIcon /></a>
              <button type="button" className="action-button secondary" onClick={() => setVerifierOpen(true)}><ChainIcon /><span>See the public proof</span></button>
            </div>
            <div className="hero-proof">
              <div><strong>Locked first</strong><span>encrypted before storage</span></div>
              <div><strong>Court access</strong><span>named people, limited time</span></div>
              <div><strong>Public proof</strong><span>every decision recorded on BSV</span></div>
            </div>
          </div>
          <div className="hero-visual" aria-label="Synthetic body camera evidence preview">
            <img src="/evidence/bodycam-frame.png" alt="Synthetic body-camera view of a vehicle stopped on a quiet road at dusk" />
            <div className="camera-topline"><span><i /> REC</span><span>SYNTHETIC DEMO · NOT REAL EVIDENCE</span></div>
            <div className="camera-meta"><span>CAM-12</span><span>2026-08-25 21:14:07Z</span></div>
            <div className="seal-card">
              <span className="seal-icon"><LockIcon /></span>
              <div><strong>Sealed at capture</strong><span>Only a valid court order can open it</span></div>
              <span className="check"><CheckIcon /></span>
            </div>
            <div className="visual-glow" />
          </div>
        </section>

        <section className="trust-strip">
          <span>One clip. Four institutions. Zero silent access.</span>
          <div className="trust-line" />
          <span className="trust-status"><i /> Live, verifiable demonstration</span>
        </section>

        <section className="demo-section" id="demo">
          <div className="section-heading">
            <div><span className="section-number">01</span><span className="eyebrow">Guided scenario</span></div>
            <h2>Can an investigation use video evidence without giving everyone access?</h2>
            <p>Step through one case as the officer, judge, prosecutor, and public auditor. The protection is real; the identities and footage are fictional.</p>
          </div>

          <div className="role-switcher" aria-label="Current demo role">
            {(Object.keys(ROLE_META) as Role[]).map(item => (
              <button type="button" key={item} aria-pressed={role === item} className={role === item ? 'active' : ''} onClick={() => setRole(item)}>
                <span>{item.slice(0, 1)}</span>{item}
              </button>
            ))}
          </div>

          <div className="scenario-grid">
            <article className="evidence-panel">
              <div className="panel-header">
                <div>
                  <span className="record-kicker">Evidence record</span>
                  <h3>{activeRecord?.evidenceId ?? 'EV-2026-1042-A'}</h3>
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
                  <div className="locked-overlay"><LockIcon /><strong>Encrypted evidence</strong><span>A valid signed order is required to open this video</span></div>
                ) : null}
                {state === 'expired' ? (
                  <div className="locked-overlay expired-overlay"><ClockIcon /><strong>Access expired</strong><span>Official copy retired · unlocking key destroyed</span></div>
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
                <div><span className="record-kicker">Independent record</span><h3>Public BSV history</h3></div>
                <span className="live-dot"><i /> ON BSV</span>
              </div>
              <div className="timeline">
                {events.map((event, index) => {
                  const txid = transactionForEvent(event.key)
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

              <button type="button" className="verify-button" onClick={() => setVerifierOpen(true)}>
                <FingerprintIcon />
                <span><strong>Verify this record yourself</strong><small>Check the signatures and complete history directly from BSV</small></span>
                <ArrowIcon />
              </button>
            </aside>
          </div>
        </section>

        <section className="retention-shell">
          <div className="retention-section">
            <div className="retention-copy">
              <span className="section-number">02</span>
              <span className="eyebrow">Automatic limits</span>
              <h2>Seven days means<br /><em>seven days.</em></h2>
              <p>The seven-day rule is recorded when the camera captures the video. A valid legal hold keeps it available. Without one, the official copy is retired and its access key is destroyed.</p>
              <div className="honesty-note"><ShieldIcon /><span><strong>An honest limit.</strong> The public record proves what the official system did. No technology can prove that a rogue third party never made a separate copy.</span></div>
            </div>
            <div className="retention-card">
              <div className="retention-top"><span>DEMO SEVEN-DAY CLOCK</span><strong>{state === 'expired' ? 'EXPIRED' : state === 'held' ? 'ON HOLD' : '6d 23h 42m'}</strong></div>
              <div className="retention-track"><span style={{ width: `${retentionPercent}%` }} /></div>
              <div className="retention-labels"><span>CAPTURED</span><span>7-DAY DEADLINE</span></div>
              <div className="policy-paths">
                <div className={state === 'held' ? 'selected' : ''}><span className="path-icon hold"><ScaleIcon /></span><div><strong>Legal hold arrives</strong><p>The signed order keeps the official video available for the case.</p></div><CheckIcon /></div>
                <div className={state === 'expired' ? 'selected expired' : ''}><span className="path-icon expire"><ClockIcon /></span><div><strong>No hold arrives</strong><p>The official copy is retired and the key needed to open it is destroyed.</p></div><CheckIcon /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="architecture-section" id="architecture">
          <div className="section-heading compact-heading">
            <div><span className="section-number">03</span><span className="eyebrow">How it works</span></div>
            <h2>Protect the video. Prove every decision.</h2>
            <p>Three simple safeguards keep access narrow and make silent changes visible.</p>
          </div>
          <div className="architecture-grid">
            <div className="architecture-card"><span><LockIcon /></span><small>01 · AT CAPTURE</small><h3>Lock it immediately</h3><p>Each recording is encrypted before a storage provider ever receives it.</p><code>Video fingerprint · {shortHash(DEMO_EVIDENCE.plaintextSha256, 10, 6)}</code></div>
            <div className="architecture-connector"><ArrowIcon /></div>
            <div className="architecture-card"><span><DatabaseIcon /></span><small>02 · ENCRYPTED STORAGE</small><h3>Detect any change</h3><p>The encrypted file has a unique fingerprint, so even a one-byte change is obvious.</p><code>Encrypted-file fingerprint · {shortHash(DEMO_EVIDENCE.ciphertextSha256, 10, 6)}</code></div>
            <div className="architecture-connector"><ArrowIcon /></div>
            <div className="architecture-card"><span><ChainIcon /></span><small>03 · PUBLIC BSV RECORD</small><h3>Make decisions visible</h3><p>Every signed update replaces the prior state while preserving a history anyone can verify.</p><code>{events.length} verified steps in this session</code></div>
          </div>
        </section>

        <section className="closing-section">
          <div><span className="eyebrow">Built as a response to a real question</span><h2>Useful evidence systems<br />do not require silent surveillance.</h2></div>
          <button type="button" className="action-button light" onClick={resetDemo}><PlayIcon /><span>Run the demo again</span><ArrowIcon /></button>
        </section>
      </main>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark"><ShieldIcon /></span><span><strong>BSV</strong> Evidence Gate</span></div>
        <p>Open proof-of-concept · Fictional identities · Synthetic footage · Not a production evidence system</p>
        <div><a href="https://github.com/p2ppsr/bsv-evidence-gate" target="_blank" rel="noreferrer">Source <ExternalIcon /></a><a href="https://bsv.brc.dev/overlays/0026" target="_blank" rel="noreferrer">Technical standard <ExternalIcon /></a></div>
      </footer>

      {verifierOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setVerifierOpen(false)}>
          <section className="verifier-modal" role="dialog" aria-modal="true" aria-labelledby="verifier-title" onMouseDown={event => event.stopPropagation()}>
            <button ref={closeButtonRef} type="button" className="modal-close" onClick={() => setVerifierOpen(false)} aria-label="Close verifier">×</button>
            <span className="verifier-mark"><FingerprintIcon /></span>
            <span className="eyebrow">Independent check</span>
            <h2 id="verifier-title">See the proof for yourself.</h2>
            <p>Your browser checks the public BSV record directly. It confirms who signed it, whether every step follows the rules, and whether anything was silently replaced.</p>
            <div className="verification-list">
              <div><span className={ledgerVerification ? '' : 'muted'}>{ledgerVerification ? <CheckIcon /> : <ClockIcon />}</span><section><small>PUBLIC BSV RECORD</small><code>{ledgerChecking ? 'Checking the live record…' : ledgerVerification ? `${ledgerVerification.records.held.historyLength}-step hold record · ${ledgerVerification.records.expired.historyLength}-step expiry record` : 'Waiting to verify'}</code><p>{ledgerVerification ? `Record owner and both histories verified at ${new Date(ledgerVerification.checkedAt).toLocaleTimeString()}.` : ledgerError || 'This check runs directly in your browser.'}</p></section></div>
              <div><span><CheckIcon /></span><section><small>ORIGINAL VIDEO FINGERPRINT</small><code>{DEMO_EVIDENCE.plaintextSha256}</code><p>{verifiedPlaintextHash ? 'Checked against the opened video. It is an exact match.' : 'Recorded when the camera captured the video and checked again whenever it opens.'}</p></section></div>
              <div><span><CheckIcon /></span><section><small>ENCRYPTED FILE FINGERPRINT</small><code>{DEMO_EVIDENCE.ciphertextSha256}</code><p>{verifiedCiphertextHash ? 'Checked against the stored encrypted file. It is an exact match.' : `${fileSize(DEMO_EVIDENCE.ciphertextBytes)} encrypted file stored separately from the public record.`}</p></section></div>
              <div><span className={warrant ? '' : 'muted'}>{warrant ? <CheckIcon /> : <ClockIcon />}</span><section><small>COURT ORDER SIGNATURE</small><code>{warrant ? shortHash(warrant.signatureBase64, 18, 12) : 'Run the guided scenario to create one'}</code><p>{warrant ? `Signed for ${warrant.payload.grantee} and limited to this browser session.` : 'No court order has been issued in this session.'}</p></section></div>
            </div>
            <div className="transaction-heading"><strong>Step-by-step public record</strong><span>Open any BSV transaction</span></div>
            <div className="transaction-grid">
              {(activeRecord?.history ?? []).map(item => <div key={item.outpoint}><span>{item.value.sequence + 1}. {item.value.state.replaceAll('_', ' ')}</span><TxLink txid={item.txid} config={config} /></div>)}
            </div>
            <button type="button" className="action-button primary modal-action" onClick={() => setVerifierOpen(false)}><CheckIcon /><span>Done</span></button>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default App
