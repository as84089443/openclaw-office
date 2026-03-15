import { initializeFnbPersistence } from '../lib/fnb/persistence.js'
import { getServiceStatus } from '../lib/fnb-service.js'

async function main() {
  const persistence = await initializeFnbPersistence()
  const status = await getServiceStatus()

  console.log('[FNB] persistence ready')
  console.log(JSON.stringify({
    provider: persistence.kind,
    environment: status.environment,
    demoMode: status.demoMode,
  }, null, 2))
}

main().catch((error) => {
  console.error('[FNB] migration failed')
  console.error(error)
  process.exit(1)
})
