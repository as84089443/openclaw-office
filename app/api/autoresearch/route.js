import { getAutoResearchSnapshot } from '../../../lib/autoresearch-snapshot.js'
import {
  listAutoResearchModelOptions,
  startAutoResearchRun,
  stopAutoResearchRun,
  updateAutoResearchManualConfig,
  updateAutoResearchStrategyConfig,
  updateAutoResearchSchedules,
} from '../../../lib/autoresearch-control.js'
import { assertOfficeApiRequest, getOfficeRequestErrorStatus } from '../../../lib/office-route-auth.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    assertOfficeApiRequest(request)
  } catch (error) {
    return Response.json(
      { error: error.message || '這個請求沒有研究控制台的存取權限' },
      { status: getOfficeRequestErrorStatus(error, 401) },
    )
  }

  try {
    const snapshot = await getAutoResearchSnapshot()
    return Response.json({
      ...snapshot,
      strategy: {
        ...snapshot.strategy,
        availableModels: snapshot.strategy?.availableModels || listAutoResearchModelOptions([
          snapshot.strategy?.primaryModel,
          snapshot.strategy?.breakthroughModel,
        ]),
      },
    })
  } catch (error) {
    console.error('[autoresearch] failed:', error)
    return Response.json(
      { error: error.message || '目前暫時讀不到 AutoResearch 狀態' },
      { status: 500 },
    )
  }
}

export async function POST(request) {
  try {
    assertOfficeApiRequest(request)
  } catch (error) {
    return Response.json(
      { error: error.message || '這個請求沒有研究控制台的存取權限' },
      { status: getOfficeRequestErrorStatus(error, 401) },
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || '').trim()

    if (action === 'start') {
      const result = await startAutoResearchRun({
        source: 'ui',
        softMinutes: body?.softMinutes,
        hardMinutes: body?.hardMinutes,
        maxExperiments: body?.maxExperiments,
      })
      return Response.json(result)
    }

    if (action === 'stop') {
      const result = await stopAutoResearchRun({ force: Boolean(body?.force) })
      return Response.json(result)
    }

    return Response.json({ error: '未知的操作指令' }, { status: 400 })
  } catch (error) {
    return Response.json({ error: error.message || '無法執行 AutoResearch 控制操作' }, { status: 400 })
  }
}

export async function PATCH(request) {
  try {
    assertOfficeApiRequest(request)
  } catch (error) {
    return Response.json(
      { error: error.message || '這個請求沒有研究控制台的存取權限' },
      { status: getOfficeRequestErrorStatus(error, 401) },
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const hasScheduleUpdate = ['nightlyTime', 'watchTime', 'nightlyEnabled', 'watchEnabled']
      .some((key) => Object.prototype.hasOwnProperty.call(body, key))
    const hasStrategyUpdate = ['primaryModel', 'breakthroughModel']
      .some((key) => Object.prototype.hasOwnProperty.call(body, key))
    const hasManualUpdate = ['softMinutes', 'hardMinutes', 'maxExperiments']
      .some((key) => Object.prototype.hasOwnProperty.call(body, key))

    if (!hasScheduleUpdate && !hasStrategyUpdate && !hasManualUpdate) {
      return Response.json({ error: '沒有可更新的 AutoResearch 設定' }, { status: 400 })
    }

    const [schedule, strategy, manualControl] = await Promise.all([
      hasScheduleUpdate
        ? updateAutoResearchSchedules({
            nightlyTime: body?.nightlyTime,
            watchTime: body?.watchTime,
            nightlyEnabled: typeof body?.nightlyEnabled === 'boolean' ? body.nightlyEnabled : undefined,
            watchEnabled: typeof body?.watchEnabled === 'boolean' ? body.watchEnabled : undefined,
          })
        : Promise.resolve(null),
      hasStrategyUpdate
        ? updateAutoResearchStrategyConfig({
            primaryModel: body?.primaryModel,
            breakthroughModel: body?.breakthroughModel,
          })
        : Promise.resolve(null),
      hasManualUpdate
        ? updateAutoResearchManualConfig({
            softMinutes: body?.softMinutes,
            hardMinutes: body?.hardMinutes,
            maxExperiments: body?.maxExperiments,
          })
        : Promise.resolve(null),
    ])

    return Response.json({
      ok: true,
      manualControl,
      schedule,
      strategy: strategy
        ? {
            ...strategy,
            availableModels: listAutoResearchModelOptions([
              strategy.primaryModel,
              strategy.breakthroughModel,
            ]),
          }
        : null,
    })
  } catch (error) {
    return Response.json({ error: error.message || '無法更新 AutoResearch 設定' }, { status: 400 })
  }
}
