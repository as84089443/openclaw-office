function normalizeText(value = '') {
  return String(value || '').trim()
}

export function isExternalConversationSessionKey(sessionKey) {
  const key = normalizeText(sessionKey)
  if (!key.startsWith('agent:')) return false
  return /^agent:[^:]+:(discord|telegram|slack|feishu|lark|line|imessage|mail|email|sms|whatsapp|wechat):/i.test(key)
}

export function isWorkflowTaskSessionKey(sessionKey) {
  const key = normalizeText(sessionKey)
  return /^agent:[^:]+:workflow:(task|child|sidecar):/i.test(key)
}

export function buildWorkflowTaskSessionKey(task) {
  const agentId = normalizeText(task?.assignedAgent) || 'main'
  const taskId = normalizeText(task?.id) || 'pending'
  const scope = task?.taskType && task.taskType !== 'primary' ? 'child' : 'task'
  return `agent:${agentId}:workflow:${scope}:${taskId}`
}

export function buildWorkflowSidecarSessionKey(parentTask, sidecarAgentId) {
  const agentId = normalizeText(sidecarAgentId) || 'unknown'
  const parentTaskId = normalizeText(parentTask?.id) || 'unknown'
  return `agent:${agentId}:workflow:sidecar:${parentTaskId}`
}

export function resolveWorkflowDispatchSessionKey(task) {
  const existing = normalizeText(task?.dispatchSessionKey)
  if (existing && !isExternalConversationSessionKey(existing)) {
    return existing
  }
  return buildWorkflowTaskSessionKey(task)
}
