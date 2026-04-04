import {
  FormEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState
} from 'react'
import {
  AppendDesktopMessageResponse,
  ContentBlock,
  ConversationMessage,
  CreateDesktopSessionResponse,
  DesktopBootstrap,
  DesktopCustomizeResponse,
  DesktopCustomizeState,
  DesktopDispatchItemResponse,
  DesktopDispatchPriority,
  DesktopDispatchResponse,
  DesktopDispatchStatus,
  DesktopDispatchState,
  DesktopScheduledResponse,
  DesktopScheduledState,
  DesktopScheduledTaskResponse,
  DesktopWeekday,
  DesktopSearchHit,
  DesktopSessionDetail,
  DesktopSessionSection,
  DesktopSessionSummary,
  DesktopSettingsResponse,
  DesktopSettingsState,
  DesktopSettingsGroup,
  DesktopTopTab,
  DesktopWorkbench,
  SearchDesktopSessionsResponse,
  SessionEvent
} from './types'

const API_BASE =
  (import.meta.env.VITE_DESKTOP_API_BASE as string | undefined) ??
  'http://127.0.0.1:4357'
const DEFAULT_PROJECT_PATH_FALLBACK =
  '/Users/champion/Documents/develop/Warwolf/open-claude-code'

function detectTauriDesktop() {
  const candidate = window as Window & {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }

  return Boolean(candidate.__TAURI__ || candidate.__TAURI_INTERNALS__)
}

type WorkspaceSurface =
  | 'home'
  | 'search'
  | 'scheduled'
  | 'dispatch'
  | 'customize'
  | 'openclaw'
  | 'settings'
  | 'session'

interface UiTab {
  id: string
  label: string
  surface: WorkspaceSurface
  sessionId?: string
  closable: boolean
}

const fixedSurfaceById: Record<string, WorkspaceSurface> = {
  home: 'home',
  search: 'search',
  scheduled: 'scheduled',
  dispatch: 'dispatch',
  customize: 'customize',
  openclaw: 'openclaw',
  settings: 'settings'
}

export default function App() {
  const isTauriDesktop = detectTauriDesktop()
  const [bootstrap, setBootstrap] = useState<DesktopBootstrap | null>(null)
  const [workbench, setWorkbench] = useState<DesktopWorkbench | null>(null)
  const [tabs, setTabs] = useState<UiTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const [sessionCache, setSessionCache] = useState<Record<string, DesktopSessionDetail>>({})
  const [composerValue, setComposerValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DesktopSearchHit[]>([])
  const [customizeState, setCustomizeState] = useState<DesktopCustomizeState | null>(null)
  const [dispatchState, setDispatchState] = useState<DesktopDispatchState | null>(null)
  const [scheduledState, setScheduledState] = useState<DesktopScheduledState | null>(null)
  const [settingsState, setSettingsState] = useState<DesktopSettingsState | null>(null)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [isSendingMessage, setIsSendingMessage] = useState(false)

  const deferredSearchQuery = useDeferredValue(searchQuery)

  useEffect(() => {
    void Promise.all([
      fetchJson<DesktopBootstrap>('/api/desktop/bootstrap'),
      fetchJson<DesktopWorkbench>('/api/desktop/workbench')
    ]).then(([nextBootstrap, nextWorkbench]) => {
      setBootstrap(nextBootstrap)
      setWorkbench(nextWorkbench)
      const initialTabs = buildInitialTabs(
        nextBootstrap.top_tabs,
        nextWorkbench.active_session_id,
        nextWorkbench.session_sections
      )
      setTabs(initialTabs)
      setActiveTabId(nextWorkbench.active_session_id ? `session:${nextWorkbench.active_session_id}` : 'home')
    })
  }, [])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs]
  )

  const activeSessionId = activeTab?.surface === 'session' ? activeTab.sessionId ?? null : null
  const activeSession = activeSessionId ? sessionCache[activeSessionId] : undefined
  const activeSessionIsRunning = activeSession?.turn_state === 'running'

  useEffect(() => {
    if (!activeSessionId) return
    if (sessionCache[activeSessionId]) return
    void fetchJson<DesktopSessionDetail>(`/api/desktop/sessions/${activeSessionId}`).then((detail) => {
      setSessionCache((current) => ({ ...current, [detail.id]: detail }))
    })
  }, [activeSessionId, sessionCache])

  useEffect(() => {
    if (!activeSessionId) return

    const source = new EventSource(`${API_BASE}/api/desktop/sessions/${activeSessionId}/events`)
    source.addEventListener('snapshot', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionEvent
      if (payload.type === 'snapshot') {
        setSessionCache((current) => ({ ...current, [payload.session.id]: payload.session }))
        void refreshWorkbench()
      }
    })
    source.addEventListener('message', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionEvent
      if (payload.type !== 'message') return
      setSessionCache((current) => {
        const existing = current[payload.session_id]
        if (!existing) return current
        return {
          ...current,
          [payload.session_id]: {
            ...existing,
            session: {
              ...existing.session,
              messages: [...existing.session.messages, payload.message]
            }
          }
        }
      })
      void refreshWorkbench()
    })

    return () => {
      source.close()
    }
  }, [activeSessionId])

  const searchableSections = useMemo(() => workbench?.session_sections ?? [], [workbench])
  const availableSessions = useMemo(
    () => searchableSections.flatMap((section) => section.sessions),
    [searchableSections]
  )
  const filteredSections = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    if (!query) return searchableSections
    return searchableSections
      .map((section) => ({
        ...section,
        sessions: section.sessions.filter((session) => {
          const haystack = `${session.title} ${session.preview} ${session.project_name}`.toLowerCase()
          return haystack.includes(query)
        })
      }))
      .filter((section) => section.sessions.length > 0)
  }, [deferredSearchQuery, searchableSections])

  useEffect(() => {
    if (activeTab?.surface !== 'search') return
    const query = deferredSearchQuery.trim()
    if (!query) {
      setSearchResults([])
      return
    }

    let cancelled = false
    void fetchJson<SearchDesktopSessionsResponse>(
      `/api/desktop/search?q=${encodeURIComponent(query)}`
    ).then((response) => {
      if (!cancelled) {
        setSearchResults(response.results)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeTab?.surface, deferredSearchQuery])

  useEffect(() => {
    if (activeTab?.surface !== 'customize') return
    let cancelled = false
    void fetchJson<DesktopCustomizeResponse>('/api/desktop/customize').then((response) => {
      if (!cancelled) {
        setCustomizeState(response.customize)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeTab?.surface])

  useEffect(() => {
    if (activeTab?.surface !== 'dispatch') return
    let cancelled = false
    void fetchJson<DesktopDispatchResponse>('/api/desktop/dispatch').then((response) => {
      if (!cancelled) {
        setDispatchState(response.dispatch)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeTab?.surface])

  useEffect(() => {
    if (activeTab?.surface !== 'scheduled') return
    let cancelled = false
    void fetchJson<DesktopScheduledResponse>('/api/desktop/scheduled').then((response) => {
      if (!cancelled) {
        setScheduledState(response.scheduled)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeTab?.surface])

  useEffect(() => {
    if (activeTab?.surface !== 'settings') return
    let cancelled = false
    void fetchJson<DesktopSettingsResponse>('/api/desktop/settings').then((response) => {
      if (!cancelled) {
        setSettingsState(response.settings)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeTab?.surface])

  async function refreshWorkbench() {
    const nextWorkbench = await fetchJson<DesktopWorkbench>('/api/desktop/workbench')
    setWorkbench(nextWorkbench)
    setTabs((current) => syncSessionTabLabels(current, nextWorkbench.session_sections))
  }

  async function refreshDispatch() {
    const response = await fetchJson<DesktopDispatchResponse>('/api/desktop/dispatch')
    setDispatchState(response.dispatch)
  }

  async function refreshScheduled() {
    const response = await fetchJson<DesktopScheduledResponse>('/api/desktop/scheduled')
    setScheduledState(response.scheduled)
  }

  async function handleCreateSession() {
    if (isCreatingSession) return
    setIsCreatingSession(true)
    try {
      const response = await postJson<CreateDesktopSessionResponse>('/api/desktop/sessions', {
        title: 'New session',
        project_name: workbench?.project_name
      })
      const session = response.session
      setSessionCache((current) => ({ ...current, [session.id]: session }))
      setTabs((current) => addSessionTab(current, session.id, session.title))
      startTransition(() => {
        setActiveTabId(`session:${session.id}`)
      })
      await refreshWorkbench()
    } finally {
      setIsCreatingSession(false)
    }
  }

  async function handleSubmitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const sessionId = activeSessionId
    const message = composerValue.trim()
    if (!sessionId || !message || isSendingMessage || activeSessionIsRunning) return

    setIsSendingMessage(true)
    try {
      const response = await postJson<AppendDesktopMessageResponse>(
        `/api/desktop/sessions/${sessionId}/messages`,
        { message }
      )
      setSessionCache((current) => ({
        ...current,
        [response.session.id]: response.session
      }))
      setComposerValue('')
      await refreshWorkbench()
    } finally {
      setIsSendingMessage(false)
    }
  }

  function handleSidebarSessionClick(sessionId: string, title: string) {
    setTabs((current) => addSessionTab(current, sessionId, title))
    startTransition(() => {
      setActiveTabId(`session:${sessionId}`)
    })
  }

  function handleFixedTabClick(tabId: string) {
    if (tabId === 'code' && workbench?.active_session_id) {
      handleSidebarSessionClick(workbench.active_session_id, findSessionTitle(workbench.session_sections, workbench.active_session_id))
      return
    }
    setActiveTabId(tabId)
  }

  function handleCloseTab(tabId: string) {
    setTabs((current) => {
      const nextTabs = current.filter((tab) => tab.id !== tabId)
      if (activeTabId === tabId) {
        const fallback = nextTabs[nextTabs.length - 1] ?? current[0]
        setActiveTabId(fallback?.id ?? 'home')
      }
      return nextTabs
    })
  }

  return (
    <div className="desktop-app">
      <div className="desktop-noise" />
      <header className="desktop-titlebar">
        {isTauriDesktop ? (
          <div className="titlebar-leading-space" aria-hidden="true" />
        ) : (
          <div className="traffic-lights" aria-hidden="true">
            <span className="traffic-light close" />
            <span className="traffic-light minimize" />
            <span className="traffic-light maximize" />
          </div>
        )}
        <div className="workspace-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={tab.id === activeTabId ? 'workspace-tab active' : 'workspace-tab'}
              onClick={() =>
                tab.surface === 'session'
                  ? handleSidebarSessionClick(tab.sessionId!, tab.label)
                  : handleFixedTabClick(tab.id)
              }>
              <span>{tab.label}</span>
              {tab.closable ? (
                <span
                  className="workspace-tab-close"
                  onClick={(event) => {
                    event.stopPropagation()
                    handleCloseTab(tab.id)
                  }}>
                  ×
                </span>
              ) : null}
            </button>
          ))}
          <button className="workspace-tab add" onClick={handleCreateSession}>
            +
          </button>
        </div>
        <div className="titlebar-code-pill">{bootstrap?.code_label ?? 'Code'}</div>
      </header>

      <main className="desktop-main">
        {activeTab?.surface === 'session' && workbench ? (
          <section className="code-workbench">
            <aside className="sidebar">
              <div className="sidebar-actions">
                {workbench.primary_actions.map((action) => (
                  <button
                    key={action.id}
                    className="sidebar-action"
                    onClick={() =>
                      action.kind === 'code_session'
                        ? handleCreateSession()
                        : handleFixedTabClick(action.target_tab_id)
                    }>
                    <span className="sidebar-icon">{iconFor(action.icon)}</span>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>

              <div className="sidebar-actions secondary">
                {workbench.secondary_actions.map((action) => (
                  <button
                    key={action.id}
                    className="sidebar-action"
                    onClick={() => handleFixedTabClick(action.target_tab_id)}>
                    <span className="sidebar-icon">{iconFor(action.icon)}</span>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>

              <div className="project-filter">
                <span>{workbench.project_label}</span>
                <button className="ghost-filter">≋</button>
              </div>

              <div className="session-groups">
                {workbench.session_sections.map((section) => (
                  <div key={section.id} className="session-group">
                    <div className="session-group-title">{section.label}</div>
                    {section.sessions.map((session) => (
                      <button
                        key={session.id}
                        className={
                          session.id === activeSessionId
                            ? 'session-list-item active'
                            : 'session-list-item'
                        }
                        onClick={() => handleSidebarSessionClick(session.id, session.title)}>
                        <div className="session-list-title">{session.title}</div>
                        <div className="session-list-preview">{session.preview}</div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              <div className="sidebar-card update">
                <div className="update-mark">✦</div>
                <div className="sidebar-card-title">{workbench.update_banner.body}</div>
                <div className="sidebar-card-body">Relaunch to apply</div>
                <button className="sidebar-card-button">{workbench.update_banner.cta_label}</button>
              </div>

              <div className="sidebar-card account">
                <div className="account-avatar">P</div>
                <div>
                  <div className="sidebar-card-title">{workbench.account.name}</div>
                  <div className="sidebar-card-body">{workbench.account.plan_label}</div>
                </div>
                <div className="account-badge">{workbench.account.shortcut_label}</div>
              </div>
            </aside>

            <section className="conversation-shell">
              <div className="conversation-header">
                <div>
                  <div className="conversation-project">{activeSession?.project_name ?? workbench.project_name}</div>
                  <div className="conversation-path">{activeSession?.project_path ?? ''}</div>
                </div>
                <div className="conversation-pills">
                  <span className="pill">{workbench.composer.model_label}</span>
                  <span className="pill">{workbench.composer.environment_label}</span>
                </div>
              </div>

              <div className="conversation-canvas">
                {activeSession ? (
                  <>
                    <div className="octopus-mark">▥</div>
                    {activeSessionIsRunning ? (
                      <div className="turn-banner">Claude Code is working through this turn…</div>
                    ) : null}
                    <div className="message-list">
                      {activeSession.session.messages.map((message, index) => (
                        <MessageCard key={`${activeSession.id}-${index}`} message={message} />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    Choose a session from the sidebar or create a new one.
                  </div>
                )}
              </div>

              <form className="composer" onSubmit={handleSubmitMessage}>
                <textarea
                  value={composerValue}
                  onChange={(event) => setComposerValue(event.target.value)}
                  placeholder={
                    activeSessionIsRunning
                      ? 'This session is running a turn…'
                      : 'Describe the next step for this desktop implementation…'
                  }
                  disabled={activeSessionIsRunning}
                />
                <div className="composer-toolbar">
                  <button type="button" className="composer-pill">
                    {activeSessionIsRunning ? 'Running' : workbench.composer.permission_mode_label}
                  </button>
                  <button type="button" className="composer-pill muted">
                    {workbench.composer.environment_label}
                  </button>
                  <button
                    type="submit"
                    className="send-button"
                    disabled={isSendingMessage || activeSessionIsRunning}>
                    {activeSessionIsRunning ? 'Running…' : isSendingMessage ? '…' : workbench.composer.send_label}
                  </button>
                </div>
              </form>
            </section>
          </section>
        ) : (
          <section className="surface-shell">
            {activeTab?.surface === 'home' ? (
              <HomeSurface bootstrap={bootstrap} onOpen={handleFixedTabClick} />
            ) : null}
            {activeTab?.surface === 'search' ? (
              <SearchSurface
                query={searchQuery}
                onChange={setSearchQuery}
                sections={filteredSections}
                results={searchResults}
                onOpenSession={handleSidebarSessionClick}
              />
            ) : null}
            {activeTab?.surface === 'scheduled' ? (
              <ScheduledSurface
                scheduled={scheduledState}
                sessions={availableSessions}
                defaultProjectName={workbench?.project_name ?? 'Warwolf'}
                defaultProjectPath={
                  activeSession?.project_path ??
                  scheduledState?.project_path ??
                  DEFAULT_PROJECT_PATH_FALLBACK
                }
                onRefreshScheduled={refreshScheduled}
                onRefreshWorkbench={refreshWorkbench}
                onOpenSession={handleSidebarSessionClick}
              />
            ) : null}
            {activeTab?.surface === 'dispatch' ? (
              <DispatchSurface
                dispatch={dispatchState}
                sessions={availableSessions}
                defaultProjectName={workbench?.project_name ?? 'Warwolf'}
                defaultProjectPath={
                  activeSession?.project_path ??
                  dispatchState?.project_path ??
                  DEFAULT_PROJECT_PATH_FALLBACK
                }
                onRefreshDispatch={refreshDispatch}
                onRefreshWorkbench={refreshWorkbench}
                onOpenSession={handleSidebarSessionClick}
              />
            ) : null}
            {activeTab?.surface === 'customize' ? (
              <CustomizeSurface customize={customizeState} />
            ) : null}
            {activeTab?.surface === 'openclaw' ? (
              <InformationalSurface
                eyebrow="OpenClaw"
                title="OpenClaw integration surface"
                body="Provider hub and managed routing will be brought in from clawhub123 after the core Code workbench reaches parity."
              />
            ) : null}
            {activeTab?.surface === 'settings' ? (
              <SettingsSurface
                groups={bootstrap?.settings_groups ?? []}
                settings={settingsState}
              />
            ) : null}
          </section>
        )}
      </main>
    </div>
  )
}

function buildInitialTabs(
  topTabs: DesktopTopTab[],
  activeSessionId: string | null,
  sections: DesktopSessionSection[]
): UiTab[] {
  const fixedTabs = topTabs.map<UiTab>((tab) => ({
    id: tab.id,
    label: tab.label,
    surface: fixedSurfaceById[tab.id] ?? 'home',
    closable: false
  }))

  if (!activeSessionId) {
    return fixedTabs
  }

  return addSessionTab(
    fixedTabs,
    activeSessionId,
    findSessionTitle(sections, activeSessionId)
  )
}

function syncSessionTabLabels(tabs: UiTab[], sections: DesktopSessionSection[]) {
  return tabs.map((tab) => {
    if (tab.surface !== 'session' || !tab.sessionId) return tab
    return {
      ...tab,
      label: findSessionTitle(sections, tab.sessionId)
    }
  })
}

function addSessionTab(tabs: UiTab[], sessionId: string, title: string): UiTab[] {
  if (tabs.some((tab) => tab.id === `session:${sessionId}`)) {
    return tabs.map((tab) =>
      tab.id === `session:${sessionId}` ? { ...tab, label: title } : tab
    )
  }

  return [
    ...tabs,
    {
      id: `session:${sessionId}`,
      label: title,
      surface: 'session',
      sessionId,
      closable: true
    }
  ]
}

function findSessionTitle(sections: DesktopSessionSection[], sessionId: string): string {
  for (const section of sections) {
    const found = section.sessions.find((session) => session.id === sessionId)
    if (found) return found.title
  }
  return 'Code session'
}

function HomeSurface({
  bootstrap,
  onOpen
}: {
  bootstrap: DesktopBootstrap | null
  onOpen: (tabId: string) => void
}) {
  return (
    <div className="surface-card">
      <div className="surface-eyebrow">Launchpad</div>
      <h1>Code-only Claude desktop shell</h1>
      <p>
        This workbench keeps the official Claude Code information architecture
        while using a Rust-first local runtime.
      </p>
      <div className="launchpad-grid">
        {bootstrap?.launchpad_items.map((item) => (
          <button
            key={item.id}
            className={`launchpad-tile accent-${item.accent}`}
            onClick={() => onOpen(item.tab_id)}>
            <div className="launchpad-tile-title">{item.label}</div>
            <div className="launchpad-tile-body">{item.description}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function SearchSurface({
  query,
  onChange,
  sections,
  results,
  onOpenSession
}: {
  query: string
  onChange: (value: string) => void
  sections: DesktopSessionSection[]
  results: DesktopSearchHit[]
  onOpenSession: (sessionId: string, title: string) => void
}) {
  const hasQuery = query.trim().length > 0

  return (
    <div className="surface-card">
      <div className="surface-eyebrow">Search</div>
      <h1>Search sessions and projects</h1>
      <input
        className="search-input"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search or start a session"
      />
      <div className="search-results">
        {hasQuery ? (
          results.length > 0 ? (
            <div className="search-section">
              <div className="search-section-title">Matches</div>
              {results.map((result) => (
                <button
                  key={result.session_id}
                  className="search-result"
                  onClick={() => onOpenSession(result.session_id, result.title)}>
                  <span>{result.title}</span>
                  <span>{result.snippet}</span>
                  <span className="search-result-meta">
                    {result.project_name} · {result.bucket}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              No sessions matched “{query.trim()}”.
            </div>
          )
        ) : (
          sections.map((section) => (
            <div key={section.id} className="search-section">
              <div className="search-section-title">{section.label}</div>
              {section.sessions.map((session) => (
                <button
                  key={session.id}
                  className="search-result"
                  onClick={() => onOpenSession(session.id, session.title)}>
                  <span>{session.title}</span>
                  <span>{session.preview}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function DispatchSurface({
  dispatch,
  sessions,
  defaultProjectName,
  defaultProjectPath,
  onRefreshDispatch,
  onRefreshWorkbench,
  onOpenSession
}: {
  dispatch: DesktopDispatchState | null
  sessions: DesktopSessionSummary[]
  defaultProjectName: string
  defaultProjectPath: string
  onRefreshDispatch: () => Promise<void>
  onRefreshWorkbench: () => Promise<void>
  onOpenSession: (sessionId: string, title: string) => void
}) {
  const [title, setTitle] = useState('Continue this code review')
  const [body, setBody] = useState(
    'Review the current workspace state, summarize the next important action, and continue the implementation if the path is clear.'
  )
  const [priority, setPriority] = useState<DesktopDispatchPriority>('normal')
  const [targetSessionId, setTargetSessionId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refreshAll() {
    await Promise.all([onRefreshDispatch(), onRefreshWorkbench()])
  }

  async function handleCreateDispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const selectedSession = sessions.find((session) => session.id === targetSessionId)
      await postJson<DesktopDispatchItemResponse>('/api/desktop/dispatch', {
        title,
        body,
        project_name: selectedSession?.project_name ?? defaultProjectName,
        project_path: selectedSession?.project_path ?? defaultProjectPath,
        target_session_id: targetSessionId || null,
        priority
      })
      await refreshAll()
      setTitle('Continue this code review')
      setBody(
        'Review the current workspace state, summarize the next important action, and continue the implementation if the path is clear.'
      )
    } catch (createError) {
      setError(errorMessage(createError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUpdateStatus(itemId: string, status: DesktopDispatchStatus) {
    setIsSubmitting(true)
    setError(null)
    try {
      await postJson<DesktopDispatchItemResponse>(
        `/api/desktop/dispatch/items/${itemId}/status`,
        { status }
      )
      await onRefreshDispatch()
    } catch (updateError) {
      setError(errorMessage(updateError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeliver(itemId: string) {
    setIsSubmitting(true)
    setError(null)
    try {
      await postJson<DesktopDispatchItemResponse>(
        `/api/desktop/dispatch/items/${itemId}/deliver`,
        {}
      )
      await refreshAll()
    } catch (deliveryError) {
      setError(errorMessage(deliveryError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="dispatch-shell">
      <div className="customize-hero">
        <div className="surface-eyebrow">Dispatch</div>
        <h1>Inbox and continuation queue</h1>
        <p>
          This is the desktop-side inbox for deferred Code work. Items can target
          an existing session or reopen the work in a fresh one, which mirrors the
          local-first continuation flow before we wire in the full remote bridge.
        </p>
        {dispatch ? (
          <div className="customize-meta">
            <span className="pill">{dispatch.project_path}</span>
            <span className="pill">{dispatch.summary.unread_item_count} unread</span>
            <span className="pill">{dispatch.summary.pending_item_count} pending</span>
          </div>
        ) : null}
      </div>

      {error ? <div className="customize-warning">{error}</div> : null}
      {dispatch?.warnings.length ? (
        <div className="customize-warning-list">
          {dispatch.warnings.map((warning) => (
            <div key={warning} className="customize-warning">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      <div className="customize-summary-grid">
        <SummaryCard
          label="Inbox items"
          value={String(dispatch?.summary.total_item_count ?? 0)}
        />
        <SummaryCard
          label="Delivered"
          value={String(dispatch?.summary.delivered_item_count ?? 0)}
        />
        <SummaryCard
          label="Archived"
          value={String(dispatch?.summary.archived_item_count ?? 0)}
        />
      </div>

      <div className="dispatch-grid">
        <section className="customize-card">
          <div className="customize-card-title">Queue a continuation</div>
          <form className="dispatch-form" onSubmit={handleCreateDispatch}>
            <label className="scheduled-field">
              <span>Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Continue this code review"
              />
            </label>

            <label className="scheduled-field">
              <span>Message</span>
              <textarea
                rows={5}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Describe the follow-up work that should land in the inbox."
              />
            </label>

            <div className="dispatch-form-row">
              <label className="scheduled-field">
                <span>Priority</span>
                <select
                  value={priority}
                  onChange={(event) =>
                    setPriority(event.target.value as DesktopDispatchPriority)
                  }>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </label>

              <label className="scheduled-field dispatch-target-field">
                <span>Target</span>
                <select
                  value={targetSessionId}
                  onChange={(event) => setTargetSessionId(event.target.value)}>
                  <option value="">Start a fresh Code session</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title} · {session.project_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button className="sidebar-card-button scheduled-submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Add to dispatch inbox'}
            </button>
          </form>
        </section>

        <section className="customize-card">
          <div className="customize-card-title">Inbox items</div>
          <div className="customize-card-body">
            {dispatch ? (
              dispatch.items.length > 0 ? (
                dispatch.items.map((item) => (
                  <div key={item.id} className="dispatch-item-card">
                    <div className="dispatch-item-head">
                      <div>
                        <strong>{item.title}</strong>
                        <div className="customize-item-subtle">
                          {item.source.label} · {item.priority}
                        </div>
                      </div>
                      <div className="scheduled-task-pills">
                        <span className={dispatchStatusClassName(item.status)}>
                          {dispatchStatusLabel(item.status)}
                        </span>
                        <span className="pill subtle">{item.target.label}</span>
                      </div>
                    </div>

                    <div className="scheduled-task-body">
                      <div>{item.body}</div>
                      <div className="customize-item-subtle">
                        Project: {item.project_name}
                      </div>
                      <code>{item.project_path}</code>
                    </div>

                    <div className="scheduled-task-meta">
                      <span>Created: {formatTimestamp(item.created_at)}</span>
                      <span>Delivered: {formatTimestamp(item.delivered_at)}</span>
                    </div>

                    {item.last_outcome ? (
                      <div
                        className={
                          item.status === 'error'
                            ? 'scheduled-task-outcome error'
                            : 'scheduled-task-outcome'
                        }>
                        {item.last_outcome}
                      </div>
                    ) : null}

                    <div className="dispatch-actions">
                      {item.status !== 'delivered' && item.status !== 'archived' ? (
                        <button
                          className="composer-pill"
                          type="button"
                          disabled={isSubmitting || item.status === 'delivering'}
                          onClick={() => void handleDeliver(item.id)}>
                          Deliver now
                        </button>
                      ) : null}
                      {item.status === 'unread' ? (
                        <button
                          className="composer-pill muted"
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => void handleUpdateStatus(item.id, 'read')}>
                          Mark read
                        </button>
                      ) : null}
                      {item.status !== 'archived' ? (
                        <button
                          className="composer-pill muted"
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => void handleUpdateStatus(item.id, 'archived')}>
                          Archive
                        </button>
                      ) : null}
                      {item.target.session_id ? (
                        <button
                          className="composer-pill muted"
                          type="button"
                          onClick={() => onOpenSession(item.target.session_id!, item.target.label)}>
                          Open session
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="customize-empty">
                  No dispatch items yet. Add one to queue a continuation without losing the thread.
                </div>
              )
            ) : (
              <div className="customize-empty">Loading dispatch inbox from the desktop runtime…</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function ScheduledSurface({
  scheduled,
  sessions,
  defaultProjectName,
  defaultProjectPath,
  onRefreshScheduled,
  onRefreshWorkbench,
  onOpenSession
}: {
  scheduled: DesktopScheduledState | null
  sessions: DesktopSessionSummary[]
  defaultProjectName: string
  defaultProjectPath: string
  onRefreshScheduled: () => Promise<void>
  onRefreshWorkbench: () => Promise<void>
  onOpenSession: (sessionId: string, title: string) => void
}) {
  const [title, setTitle] = useState('Morning workspace scan')
  const [prompt, setPrompt] = useState(
    'Review the workspace, summarize the highest-value next step, and continue if the path is clear.'
  )
  const [scheduleKind, setScheduleKind] = useState<'hourly' | 'weekly'>('hourly')
  const [intervalHours, setIntervalHours] = useState('4')
  const [weeklyHour, setWeeklyHour] = useState('09')
  const [weeklyMinute, setWeeklyMinute] = useState('00')
  const [weeklyDays, setWeeklyDays] = useState<DesktopWeekday[]>([
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday'
  ])
  const [targetSessionId, setTargetSessionId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refreshAll() {
    await Promise.all([onRefreshScheduled(), onRefreshWorkbench()])
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const selectedSession = sessions.find((session) => session.id === targetSessionId)
      await postJson<DesktopScheduledTaskResponse>('/api/desktop/scheduled', {
        title,
        prompt,
        project_name: selectedSession?.project_name ?? defaultProjectName,
        project_path: selectedSession?.project_path ?? defaultProjectPath,
        target_session_id: targetSessionId || null,
        schedule:
          scheduleKind === 'hourly'
            ? {
                kind: 'hourly',
                interval_hours: Number(intervalHours || '1')
              }
            : {
                kind: 'weekly',
                days: weeklyDays,
                hour: Number(weeklyHour || '0'),
                minute: Number(weeklyMinute || '0')
              }
      })
      await refreshAll()
      setTitle('Morning workspace scan')
      setPrompt(
        'Review the workspace, summarize the highest-value next step, and continue if the path is clear.'
      )
    } catch (createError) {
      setError(errorMessage(createError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleToggleTask(taskId: string, enabled: boolean) {
    setIsSubmitting(true)
    setError(null)
    try {
      await postJson<DesktopScheduledTaskResponse>(`/api/desktop/scheduled/${taskId}/enabled`, {
        enabled
      })
      await refreshAll()
    } catch (toggleError) {
      setError(errorMessage(toggleError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRunNow(taskId: string) {
    setIsSubmitting(true)
    setError(null)
    try {
      await postJson<DesktopScheduledTaskResponse>(`/api/desktop/scheduled/${taskId}/run`, {})
      await refreshAll()
    } catch (runError) {
      setError(errorMessage(runError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="scheduled-shell">
      <div className="customize-hero">
        <div className="surface-eyebrow">Scheduled</div>
        <h1>Local-first scheduled Code tasks</h1>
        <p>
          These schedules live in the desktop Rust runtime, persist locally, and
          can either reopen an existing Code session or spin up a fresh one.
        </p>
        {scheduled ? (
          <div className="customize-meta">
            <span className="pill">{scheduled.project_path}</span>
            <span className="pill">
              {scheduled.summary.enabled_task_count}/{scheduled.summary.total_task_count} enabled
            </span>
            <span className="pill">{scheduled.summary.due_task_count} due</span>
          </div>
        ) : null}
      </div>

      {error ? <div className="customize-warning">{error}</div> : null}
      {scheduled?.warnings.length ? (
        <div className="customize-warning-list">
          {scheduled.warnings.map((warning) => (
            <div key={warning} className="customize-warning">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      <div className="customize-summary-grid">
        <SummaryCard
          label="Total tasks"
          value={String(scheduled?.summary.total_task_count ?? 0)}
        />
        <SummaryCard
          label="Running"
          value={String(scheduled?.summary.running_task_count ?? 0)}
        />
        <SummaryCard
          label="Blocked"
          value={String(scheduled?.summary.blocked_task_count ?? 0)}
        />
        <SummaryCard label="Trusted paths" value={String(scheduled?.trusted_project_paths.length ?? 0)} />
      </div>

      <div className="scheduled-grid">
        <section className="customize-card">
          <div className="customize-card-title">Create a scheduled task</div>
          <form className="scheduled-form" onSubmit={handleCreateTask}>
            <label className="scheduled-field">
              <span>Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Morning workspace scan"
              />
            </label>

            <label className="scheduled-field">
              <span>Prompt</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={5}
                placeholder="Describe what the scheduled Code turn should do."
              />
            </label>

            <label className="scheduled-field">
              <span>Target</span>
              <select
                value={targetSessionId}
                onChange={(event) => setTargetSessionId(event.target.value)}>
                <option value="">Start a fresh session every run</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title} · {session.project_name}
                  </option>
                ))}
              </select>
            </label>

            <div className="scheduled-form-row">
              <label className="scheduled-field">
                <span>Cadence</span>
                <select
                  value={scheduleKind}
                  onChange={(event) => setScheduleKind(event.target.value as 'hourly' | 'weekly')}>
                  <option value="hourly">Hourly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>

              {scheduleKind === 'hourly' ? (
                <label className="scheduled-field">
                  <span>Interval (hours)</span>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={intervalHours}
                    onChange={(event) => setIntervalHours(event.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label className="scheduled-field">
                    <span>Hour</span>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={weeklyHour}
                      onChange={(event) => setWeeklyHour(event.target.value)}
                    />
                  </label>
                  <label className="scheduled-field">
                    <span>Minute</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={weeklyMinute}
                      onChange={(event) => setWeeklyMinute(event.target.value)}
                    />
                  </label>
                </>
              )}
            </div>

            {scheduleKind === 'weekly' ? (
              <div className="scheduled-field">
                <span>Days</span>
                <div className="weekday-grid">
                  {WEEKDAY_OPTIONS.map((day) => (
                    <button
                      type="button"
                      key={day.value}
                      className={
                        weeklyDays.includes(day.value)
                          ? 'weekday-pill active'
                          : 'weekday-pill'
                      }
                      onClick={() =>
                        setWeeklyDays((current) =>
                          current.includes(day.value)
                            ? current.filter((value) => value !== day.value)
                            : [...current, day.value]
                        )
                      }>
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button className="sidebar-card-button scheduled-submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Create scheduled task'}
            </button>
          </form>
        </section>

        <section className="customize-card">
          <div className="customize-card-title">Active tasks</div>
          <div className="customize-card-body">
            {scheduled ? (
              scheduled.tasks.length > 0 ? (
                scheduled.tasks.map((task) => (
                  <div key={task.id} className="scheduled-task-card">
                    <div className="scheduled-task-head">
                      <div>
                        <strong>{task.title}</strong>
                        <div className="customize-item-subtle">{task.schedule_label}</div>
                      </div>
                      <div className="scheduled-task-pills">
                        <span className={task.enabled ? 'status-pill enabled' : 'status-pill'}>
                          {task.enabled ? 'Enabled' : 'Paused'}
                        </span>
                        <span className="pill subtle">
                          {task.status === 'running' ? 'Running' : 'Idle'}
                        </span>
                      </div>
                    </div>

                    <div className="scheduled-task-body">
                      <div>{task.prompt}</div>
                      <div className="customize-item-subtle">
                        Target: {task.target.label} · Project: {task.project_name}
                      </div>
                      <code>{task.project_path}</code>
                    </div>

                    {task.blocked_reason ? (
                      <div className="customize-warning">{task.blocked_reason}</div>
                    ) : null}

                    <div className="scheduled-task-meta">
                      <span>Next run: {formatTimestamp(task.next_run_at)}</span>
                      <span>Last run: {formatTimestamp(task.last_run_at)}</span>
                    </div>

                    {task.last_outcome ? (
                      <div
                        className={
                          task.last_run_status === 'error'
                            ? 'scheduled-task-outcome error'
                            : 'scheduled-task-outcome'
                        }>
                        {task.last_outcome}
                      </div>
                    ) : null}

                    <div className="scheduled-task-actions">
                      <button
                        className="composer-pill"
                        type="button"
                        onClick={() => void handleRunNow(task.id)}
                        disabled={isSubmitting || task.status === 'running'}>
                        Run now
                      </button>
                      <button
                        className="composer-pill muted"
                        type="button"
                        onClick={() => void handleToggleTask(task.id, !task.enabled)}
                        disabled={isSubmitting}>
                        {task.enabled ? 'Pause' : 'Resume'}
                      </button>
                      {task.target.session_id ? (
                        <button
                          className="composer-pill muted"
                          type="button"
                          onClick={() => onOpenSession(task.target.session_id!, task.target.label)}>
                          Open session
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="customize-empty">
                  No scheduled tasks yet. Create one to keep the Code workbench moving in the background.
                </div>
              )
            ) : (
              <div className="customize-empty">Loading scheduled tasks from the desktop runtime…</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function CustomizeSurface({
  customize
}: {
  customize: DesktopCustomizeState | null
}) {
  if (!customize) {
    return (
      <div className="surface-card">
        <div className="surface-eyebrow">Customize</div>
        <h1>Loading runtime configuration</h1>
        <p>The desktop shell is reading hooks, MCP servers, and plugin metadata from the Rust workspace.</p>
      </div>
    )
  }

  return (
    <div className="customize-shell">
      <div className="customize-hero">
        <div className="surface-eyebrow">Customize</div>
        <h1>Runtime-backed desktop configuration</h1>
        <p>
          This view is reading the same model defaults, hooks, MCP server definitions,
          and plugin registry that the Rust runtime uses for Code sessions.
        </p>
        <div className="customize-meta">
          <span className="pill">{customize.model_label}</span>
          <span className="pill">{customize.permission_mode}</span>
          <span className="pill">{customize.project_path}</span>
        </div>
      </div>

      <div className="customize-summary-grid">
        <SummaryCard label="Config files" value={String(customize.summary.loaded_config_count)} />
        <SummaryCard label="MCP servers" value={String(customize.summary.mcp_server_count)} />
        <SummaryCard
          label="Enabled plugins"
          value={`${customize.summary.enabled_plugin_count}/${customize.summary.plugin_count}`}
        />
        <SummaryCard label="Plugin tools" value={String(customize.summary.plugin_tool_count)} />
        <SummaryCard label="Pre-tool hooks" value={String(customize.summary.pre_tool_hook_count)} />
        <SummaryCard label="Post-tool hooks" value={String(customize.summary.post_tool_hook_count)} />
      </div>

      {customize.warnings.length > 0 ? (
        <div className="customize-warning-list">
          {customize.warnings.map((warning) => (
            <div key={warning} className="customize-warning">
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      <div className="customize-grid">
        <section className="customize-card">
          <div className="customize-card-title">Loaded settings files</div>
          <div className="customize-card-body">
            {customize.loaded_configs.length > 0 ? (
              customize.loaded_configs.map((config) => (
                <div key={config.path} className="customize-row">
                  <span>{config.source}</span>
                  <code>{config.path}</code>
                </div>
              ))
            ) : (
              <div className="customize-empty">No settings files were loaded for this workspace.</div>
            )}
          </div>
        </section>

        <section className="customize-card">
          <div className="customize-card-title">Hooks</div>
          <div className="customize-card-body">
            <HookList title="PreToolUse" items={customize.hooks.pre_tool_use} />
            <HookList title="PostToolUse" items={customize.hooks.post_tool_use} />
          </div>
        </section>

        <section className="customize-card">
          <div className="customize-card-title">MCP servers</div>
          <div className="customize-card-body">
            {customize.mcp_servers.length > 0 ? (
              customize.mcp_servers.map((server) => (
                <div key={`${server.name}-${server.target}`} className="customize-item-card">
                  <div className="customize-item-head">
                    <strong>{server.name}</strong>
                    <span className="pill subtle">{server.transport}</span>
                  </div>
                  <div className="customize-item-subtle">{server.scope}</div>
                  <code>{server.target}</code>
                </div>
              ))
            ) : (
              <div className="customize-empty">No MCP servers are configured.</div>
            )}
          </div>
        </section>

        <section className="customize-card">
          <div className="customize-card-title">Plugins</div>
          <div className="customize-card-body">
            {customize.plugins.length > 0 ? (
              customize.plugins.map((plugin) => (
                <div key={plugin.id} className="customize-item-card">
                  <div className="customize-item-head">
                    <strong>{plugin.name}</strong>
                    <span className={plugin.enabled ? 'status-pill enabled' : 'status-pill'}>
                      {plugin.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="customize-item-subtle">
                    {plugin.kind} · v{plugin.version} · {plugin.source}
                  </div>
                  <div>{plugin.description}</div>
                  <div className="customize-plugin-metrics">
                    <span>{plugin.tool_count} tools</span>
                    <span>{plugin.pre_tool_hook_count} pre hooks</span>
                    <span>{plugin.post_tool_hook_count} post hooks</span>
                  </div>
                  {plugin.root_path ? <code>{plugin.root_path}</code> : null}
                </div>
              ))
            ) : (
              <div className="customize-empty">No plugins were discovered for this workspace.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function HookList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="hook-group">
      <div className="hook-group-title">{title}</div>
      {items.length > 0 ? (
        items.map((item) => (
          <code key={`${title}-${item}`} className="hook-command">
            {item}
          </code>
        ))
      ) : (
        <div className="customize-empty">No commands configured.</div>
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-card">
      <div className="summary-card-label">{label}</div>
      <div className="summary-card-value">{value}</div>
    </div>
  )
}

function SettingsSurface({
  groups,
  settings
}: {
  groups: DesktopSettingsGroup[]
  settings: DesktopSettingsState | null
}) {
  return (
    <div className="settings-shell">
      <div className="settings-sidebar">
        {groups.map((group) => (
          <div key={group.id} className="settings-sidebar-item">
            {group.label}
          </div>
        ))}
      </div>
      <div className="settings-panel">
        <div className="surface-eyebrow">Settings</div>
        <h1>Desktop environment and provider settings</h1>
        <p>
          This view exposes the local config home, provider endpoints, desktop
          session storage, and credential paths that the Rust desktop runtime is
          actually using.
        </p>
        {settings ? (
          <>
            <div className="customize-meta">
              <span className="pill">{settings.project_path}</span>
              <span className="pill">{settings.config_home}</span>
            </div>
            {settings.warnings.length > 0 ? (
              <div className="customize-warning-list">
                {settings.warnings.map((warning) => (
                  <div key={warning} className="customize-warning">
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="settings-group-list">
              <div className="settings-group-card">
                <div className="settings-group-title">Model services</div>
                <div className="settings-group-body">
                  {settings.providers.map((provider) => (
                    <div key={provider.id} className="customize-item-card">
                      <div className="customize-item-head">
                        <strong>{provider.label}</strong>
                        <span className="pill subtle">{provider.auth_status}</span>
                      </div>
                      <code>{provider.base_url}</code>
                    </div>
                  ))}
                </div>
              </div>
              <div className="settings-group-card">
                <div className="settings-group-title">Storage</div>
                <div className="settings-group-body">
                  {settings.storage_locations.map((location) => (
                    <div key={location.path} className="customize-item-card">
                      <strong>{location.label}</strong>
                      <div className="customize-item-subtle">{location.description}</div>
                      <code>{location.path}</code>
                    </div>
                  ))}
                  {settings.oauth_credentials_path ? (
                    <div className="customize-item-card">
                      <strong>OAuth credentials</strong>
                      <div className="customize-item-subtle">
                        Saved bearer and refresh tokens for Claw auth.
                      </div>
                      <code>{settings.oauth_credentials_path}</code>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="settings-group-card">
                <div className="settings-group-title">Organization</div>
                <div className="settings-group-body">
                  {groups.map((group) => (
                    <div key={group.id} className="customize-item-card">
                      <strong>{group.label}</strong>
                      <div className="customize-item-subtle">{group.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="settings-group-list">
            <div className="settings-group-card">
              <div className="settings-group-title">Loading settings…</div>
              <div className="settings-group-body">
                The desktop shell is reading provider endpoints and local storage paths.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function InformationalSurface({
  eyebrow,
  title,
  body
}: {
  eyebrow: string
  title: string
  body: string
}) {
  return (
    <div className="surface-card">
      <div className="surface-eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  )
}

function MessageCard({ message }: { message: ConversationMessage }) {
  return (
    <article className={`message-card role-${message.role}`}>
      <div className="message-role">{message.role}</div>
      <div className="message-content">
        {message.blocks.map((block, index) => (
          <MessageBlock key={`${message.role}-${index}`} block={block} />
        ))}
      </div>
    </article>
  )
}

function MessageBlock({ block }: { block: ContentBlock }) {
  if (block.type === 'text') {
    return <p>{block.text}</p>
  }

  if (block.type === 'tool_use') {
    return (
      <div className="tool-block">
        <strong>{block.name}</strong>
        <code>{block.input}</code>
      </div>
    )
  }

  return (
    <div className={block.is_error ? 'tool-block error' : 'tool-block'}>
      <strong>{block.tool_name}</strong>
      <code>{block.output}</code>
    </div>
  )
}

const WEEKDAY_OPTIONS: Array<{ label: string; value: DesktopWeekday }> = [
  { label: 'Mon', value: 'monday' },
  { label: 'Tue', value: 'tuesday' },
  { label: 'Wed', value: 'wednesday' },
  { label: 'Thu', value: 'thursday' },
  { label: 'Fri', value: 'friday' },
  { label: 'Sat', value: 'saturday' },
  { label: 'Sun', value: 'sunday' }
]

function formatTimestamp(value: number | null) {
  if (!value) return 'Not yet'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function dispatchStatusLabel(status: DesktopDispatchStatus) {
  switch (status) {
    case 'unread':
      return 'Unread'
    case 'read':
      return 'Read'
    case 'delivering':
      return 'Delivering'
    case 'delivered':
      return 'Delivered'
    case 'archived':
      return 'Archived'
    case 'error':
      return 'Error'
  }
}

function dispatchStatusClassName(status: DesktopDispatchStatus) {
  return status === 'delivered'
    ? 'status-pill enabled'
    : status === 'error'
      ? 'status-pill error'
      : 'status-pill'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed'
}

function iconFor(icon: string) {
  switch (icon) {
    case 'plus':
      return '+'
    case 'search':
      return '⌕'
    case 'clock':
      return '◷'
    case 'dispatch':
      return '⇄'
    case 'sliders':
      return '≡'
    default:
      return '•'
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed for ${path}`)
  }
  return (await response.json()) as T
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed for ${path}`)
  }
  return (await response.json()) as T
}
