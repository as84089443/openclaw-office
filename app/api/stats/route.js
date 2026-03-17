// Stats API for OpenClaw Office
// Returns real interaction statistics from SQLite + OpenClaw token tracking

import { 
  getTodayStats, 
  getAllTimeStats, 
  db,
} from '../../../lib/db'
import { 
  getTodayTokens, 
  getTotalTokens, 
  calculateOpenClawCost 
} from '../../../lib/openclaw'

function getTodayDate() {
  return new Date().toISOString().slice(0, 10)
}

function getTodayStatsReadOnly() {
  const today = getTodayDate()
  const row = db.prepare('SELECT * FROM daily_stats WHERE date = ?').get(today)
  return row || {
    messages_received: 0,
    messages_sent: 0,
    tokens_input: 0,
    tokens_output: 0,
    tasks_completed: 0,
    total_task_time_ms: 0,
    estimated_human_time_ms: 0,
    savings_myr: 0,
  }
}

export async function GET() {
  try {
    // Get SQLite stats (messages, tasks, savings)
    let today
    try {
      today = getTodayStats()
    } catch (error) {
      if (String(error.message || '').includes('readonly')) {
        today = getTodayStatsReadOnly()
      } else {
        throw error
      }
    }
    const allTime = getAllTimeStats()
    
    // Get real token usage from OpenClaw
    const [todayTokens, allTimeTokens] = await Promise.all([
      getTodayTokens(),
      getTotalTokens()
    ])
    
    const todayTotalMessages = (today.messages_received || 0) + (today.messages_sent || 0)
    const allTimeTotalMessages = (allTime.messages_received || 0) + (allTime.messages_sent || 0)
    
    // Calculate costs using real OpenClaw token data
    const todayCostUsd = calculateOpenClawCost(todayTokens)
    const allTimeCostUsd = calculateOpenClawCost(allTimeTokens)
    
    return Response.json({
      today: {
        messages: todayTotalMessages,
        tokens: {
          input: todayTokens.input,
          output: todayTokens.output,
          total: todayTokens.total,
          cacheRead: todayTokens.cacheRead,
          cacheWrite: todayTokens.cacheWrite,
        },
        cost_usd: Math.round(todayCostUsd * 100) / 100,
        savings_usd: today.savings_myr || 0,
        tasks_completed: today.tasks_completed || 0,
        task_time_ms: today.total_task_time_ms || 0,
        human_time_ms: today.estimated_human_time_ms || 0,
      },
      allTime: {
        messages: allTimeTotalMessages,
        tokens: {
          input: allTimeTokens.input,
          output: allTimeTokens.output,
          total: allTimeTokens.total,
          cacheRead: allTimeTokens.cacheRead,
          cacheWrite: allTimeTokens.cacheWrite,
        },
        cost_usd: Math.round(allTimeCostUsd * 100) / 100,
        savings_usd: allTime.savings_myr || 0,
        tasks_completed: allTime.tasks_completed || 0,
        task_time_ms: allTime.total_task_time_ms || 0,
        human_time_ms: allTime.estimated_human_time_ms || 0,
      },
      source: 'openclaw', // Indicates token data comes from OpenClaw
    })
  } catch (error) {
    console.error('Stats API error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
