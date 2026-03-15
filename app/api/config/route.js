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
} from '../../../lib/config.js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const config = getConfig()
  const bossInbox = getBossInboxConfig()

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
  }

  return Response.json(publicConfig)
}
