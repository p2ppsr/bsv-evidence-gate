export type TransactionKey = 'capture' | 'storage' | 'request' | 'warrant' | 'view' | 'hold' | 'expiry'

export interface DemoConfig {
  network: 'mainnet' | 'testnet'
  uhrpUrl: string
  uhrpHost: string
  explorerBaseUrl: string
  transactions: Record<TransactionKey, string>
}

export const loadDemoConfig = async (): Promise<DemoConfig> => {
  const response = await fetch('/demo-config.json', { cache: 'no-store' })
  if (!response.ok) throw new Error('Could not load demo configuration')
  return response.json() as Promise<DemoConfig>
}
