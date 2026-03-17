/**
 * Public config endpoint — strips secrets, exposes agent definitions & office settings
 */
import {
  getConfig,
  getAgentsList,
  getAgentsMap,
  getAgentAliases,
  getPrimaryAgentId,
  getBossInboxConfig,
  getConfigDiagnostics,
} from '../../../lib/config.js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const config = getConfig()
  const bossInbox = getBossInboxConfig()
  const diagnostics = getConfigDiagnostics()

  const publicConfig = {
    office: config.office,
    agents: getAgentsList(),
    agentsMap: getAgentsMap(),
    agentAliases: getAgentAliases(),
    primaryAgentId: getPrimaryAgentId(),
    image: config.image,
    bossInbox: {
      ...bossInbox,
      hasDiscordTarget: Boolean(bossInbox.discordTarget),
    },
    openclaw: {
      home: config.openclaw?.home || null,
      configPath: config.openclaw?.configPath || null,
    },
    diagnostics,
  }

  return Response.json(publicConfig)
}
