// Telegram notification helper for OpenClaw Office
// Sends delegation notifications (optional feature)

import { getConfig } from './config.js'

function getTelegramConfig() {
  const config = getConfig()
  return {
    botToken: config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: config.telegram?.chatId || process.env.TELEGRAM_CHAT_ID || '',
  }
}

export const DEFAULT_TELEGRAM_COMMANDS = [
  {
    command: 'research',
    description: '研究主題，例如 /research Autopen 或 /research 魚群',
  },
  {
    command: 'research_app',
    description: '研究應用程式、頁面與真實使用流程',
  },
  {
    command: 'research_fleet',
    description: '研究魚群 routing、handoff、workflow 與看板',
  },
  {
    command: 'research_feature',
    description: '研究值得開發的新功能與自動化機會',
  },
  {
    command: 'chat',
    description: '只聊天，不建立正式交辦',
  },
]

export async function sendTelegramNotification(message) {
  return sendTelegramMessage({ message })
}

export async function setTelegramCommands(commands = DEFAULT_TELEGRAM_COMMANDS) {
  const { botToken } = getTelegramConfig()
  if (!botToken) {
    console.log('[telegram-notify] Telegram bot token missing, skipping setMyCommands')
    return false
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/setMyCommands`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: commands.map(({ command, description }) => ({
          command,
          description,
        })),
      }),
    })

    if (!response.ok) {
      console.error('[telegram-notify] Failed to set commands:', await response.text())
      return false
    }

    console.log('[telegram-notify] Telegram commands updated')
    return true
  } catch (err) {
    console.error('[telegram-notify] setMyCommands error:', err.message)
    return false
  }
}

export async function sendTelegramMessage({
  message,
  chatId: overrideChatId,
  replyToMessageId,
  messageThreadId,
  disableNotification = false,
}) {
  const { botToken, chatId } = getTelegramConfig()
  const targetChatId = overrideChatId || chatId
  if (!botToken || !targetChatId) {
    console.log('[telegram-notify] Telegram not configured, skipping notification')
    return false
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        parse_mode: 'HTML',
        disable_notification: disableNotification,
        ...(replyToMessageId
          ? {
              reply_to_message_id: replyToMessageId,
              allow_sending_without_reply: true,
            }
          : {}),
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      }),
    })
    
    if (!response.ok) {
      console.error('[telegram-notify] Failed to send:', await response.text())
      return false
    }
    
    console.log('[telegram-notify] Sent delegation notification')
    return true
  } catch (err) {
    console.error('[telegram-notify] Error:', err.message)
    return false
  }
}

export function formatDelegationNotification(agent, agentEmoji, taskSummary, details = []) {
  let msg = `<b>${agent}'s on it ${agentEmoji}:</b>\n`
  if (details.length > 0) {
    details.forEach(d => { msg += `• ${d}\n` })
  } else {
    msg += `• ${taskSummary}\n`
  }
  return msg
}
