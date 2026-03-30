import { setTelegramCommands, DEFAULT_TELEGRAM_COMMANDS } from '../lib/telegram.js'

const ok = await setTelegramCommands(DEFAULT_TELEGRAM_COMMANDS)

if (!ok) {
  process.exitCode = 1
} else {
  console.log('Telegram commands synced.')
}
