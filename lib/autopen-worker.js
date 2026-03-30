export function getAutopenWorkerProxyRequest() {
  return {
    upstreamPath: '/api/cron/autopen-worker',
    method: 'GET',
    auth: 'cron-bearer',
    timeoutMs: 280000,
  }
}
