'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, Users, Shield, DollarSign, Activity, Database, Store, Inbox } from 'lucide-react'
import IsometricOffice from './IsometricOffice'
import ActivityLog from './ActivityLog'
import RequestPipeline from './RequestPipeline'
import StatsCards from './StatsCards'
import TeamDashboard from './TeamDashboard'
import SecurityDashboard from './SecurityDashboard'
import DatabaseDashboard from './DatabaseDashboard'
import CostDashboard from './CostDashboard'
import FnbOpsConsole from './FnbOpsConsole'
import BossInboxDashboard from './BossInboxDashboard'
import CurrentTasksPanel from './CurrentTasksPanel'

const tabs = [
  { id: 'boss', label: 'Boss Inbox', icon: Inbox },
  { id: 'fnb', label: 'F&B Copilot', icon: Store },
  { id: 'office', label: 'Legacy Office', icon: Building2 },
  { id: 'stats', label: 'Interaction Stats', icon: Activity },
  { id: 'team', label: 'AI Team', icon: Users },
  { id: 'cost', label: 'Cost Savings', icon: DollarSign },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'database', label: 'Database', icon: Database },
]

export default function LegacyOfficeDashboard() {
  const [activeTab, setActiveTab] = useState('boss')
  const [headerStats, setHeaderStats] = useState({
    tasks: 0,
    tokens: 0,
    savings: 0,
  })
  const [activeRequest, setActiveRequest] = useState(null)

  useEffect(() => {
    const fetchHeaderStats = async () => {
      try {
        const response = await fetch('/api/stats')
        const data = await response.json()
        setHeaderStats({
          tasks: data.allTime.tasks_completed || 0,
          tokens: data.allTime.tokens.total || 0,
          savings: Math.round(data.allTime.savings_usd || 0),
        })
      } catch (error) {
        console.error('Failed to fetch header stats:', error)
      }
    }

    fetchHeaderStats()
    const interval = setInterval(fetchHeaderStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleRequestUpdate = useCallback((request) => {
    setActiveRequest(request)
  }, [])

  return (
    <main className="min-h-screen p-4 lg:p-6 relative">
      <motion.header
        className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <motion.div
              className="gradient-border flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
              whileHover={{ scale: 1.05 }}
              style={{ background: 'linear-gradient(135deg, #0a0a1a, #1a1a3a)' }}
            >
              🏢
            </motion.div>
            <div>
              <h1 className="font-display text-2xl font-bold">
                <span className="neon-cyan">OpenClaw</span>
                <span className="mx-2 text-white">Office</span>
              </h1>
              <p className="text-xs text-gray-500">Boss Inbox + Legacy Office</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-green-500/50 bg-green-900/30 px-3 py-1.5">
            <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            <span className="text-xs font-bold text-green-400">LIVE</span>
          </div>
        </div>

        <div className="hidden items-center gap-6 text-sm lg:flex">
          <div>
            <span className="text-gray-500">Tasks: </span>
            <span className="font-bold text-cyan-400">{headerStats.tasks}</span>
          </div>
          <div>
            <span className="text-gray-500">Tokens: </span>
            <span className="font-bold text-purple-400">{(headerStats.tokens / 1000000).toFixed(2)}M</span>
          </div>
          <div>
            <span className="text-gray-500">Saved: </span>
            <span className="font-bold text-green-400">${headerStats.savings.toLocaleString()}</span>
          </div>
        </div>
      </motion.header>

      <motion.nav
        className="mb-6 flex gap-2 overflow-x-auto pb-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        {tabs.map((tab) => (
          <motion.button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id
                ? 'border border-cyan-500/50 bg-cyan-900/50 text-cyan-400'
                : 'border border-gray-700/50 bg-gray-900/50 text-gray-400 hover:text-white'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <tab.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </motion.button>
        ))}
      </motion.nav>

      <AnimatePresence mode="wait">
        {activeTab === 'boss' && (
          <motion.div
            key="boss"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <BossInboxDashboard />
          </motion.div>
        )}

        {activeTab === 'office' && (
          <motion.div
            key="office"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 gap-6 xl:grid-cols-3"
          >
            <div className="xl:col-span-2">
              <div className="glass-card h-auto rounded-xl p-4">
                <IsometricOffice activeRequest={activeRequest} />
              </div>
            </div>

            <div className="space-y-4">
              <CurrentTasksPanel />
              <RequestPipeline onRequestUpdate={handleRequestUpdate} />
              <ActivityLog />
            </div>
          </motion.div>
        )}

        {activeTab === 'fnb' && (
          <motion.div
            key="fnb"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <FnbOpsConsole />
          </motion.div>
        )}

        {activeTab === 'stats' && (
          <motion.div
            key="stats"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <StatsCards />
          </motion.div>
        )}

        {activeTab === 'team' && (
          <motion.div
            key="team"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <TeamDashboard />
          </motion.div>
        )}

        {activeTab === 'cost' && (
          <motion.div
            key="cost"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <CostDashboard />
          </motion.div>
        )}

        {activeTab === 'security' && (
          <motion.div
            key="security"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <SecurityDashboard />
          </motion.div>
        )}

        {activeTab === 'database' && (
          <motion.div
            key="database"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <DatabaseDashboard />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.footer
        className="mt-8 text-center text-xs text-gray-600"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        <p>OpenClaw © {new Date().getFullYear()} • Legacy Office Dashboard</p>
      </motion.footer>
    </main>
  )
}
