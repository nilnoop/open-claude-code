export type DesktopTabKind =
  | 'home'
  | 'search'
  | 'scheduled'
  | 'dispatch'
  | 'customize'
  | 'open_claw'
  | 'settings'
  | 'code_session'

export interface DesktopTopTab {
  id: string
  label: string
  kind: DesktopTabKind
  closable: boolean
}

export interface DesktopLaunchpadItem {
  id: string
  label: string
  description: string
  accent: string
  tab_id: string
}

export interface DesktopSettingsGroup {
  id: string
  label: string
  description: string
}

export interface DesktopBootstrap {
  product_name: string
  code_label: string
  top_tabs: DesktopTopTab[]
  launchpad_items: DesktopLaunchpadItem[]
  settings_groups: DesktopSettingsGroup[]
}

export interface DesktopSidebarAction {
  id: string
  label: string
  icon: string
  target_tab_id: string
  kind: DesktopTabKind
}

export interface DesktopSessionSummary {
  id: string
  title: string
  preview: string
  bucket: 'today' | 'yesterday' | 'older'
  created_at: number
  updated_at: number
  project_name: string
  project_path: string
  environment_label: string
  model_label: string
  turn_state: 'idle' | 'running'
}

export interface DesktopSessionSection {
  id: string
  label: string
  sessions: DesktopSessionSummary[]
}

export interface DesktopUpdateBanner {
  version: string
  cta_label: string
  body: string
}

export interface DesktopAccountCard {
  name: string
  plan_label: string
  shortcut_label: string
}

export interface DesktopComposerState {
  permission_mode_label: string
  environment_label: string
  model_label: string
  send_label: string
}

export interface DesktopWorkbench {
  primary_actions: DesktopSidebarAction[]
  secondary_actions: DesktopSidebarAction[]
  project_label: string
  project_name: string
  session_sections: DesktopSessionSection[]
  active_session_id: string | null
  update_banner: DesktopUpdateBanner
  account: DesktopAccountCard
  composer: DesktopComposerState
}

export interface ContentBlockText {
  type: 'text'
  text: string
}

export interface ContentBlockToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: string
}

export interface ContentBlockToolResult {
  type: 'tool_result'
  tool_use_id: string
  tool_name: string
  output: string
  is_error: boolean
}

export type ContentBlock =
  | ContentBlockText
  | ContentBlockToolUse
  | ContentBlockToolResult

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  blocks: ContentBlock[]
}

export interface RuntimeSession {
  version: number
  messages: ConversationMessage[]
}

export interface DesktopSessionDetail {
  id: string
  title: string
  preview: string
  created_at: number
  updated_at: number
  project_name: string
  project_path: string
  environment_label: string
  model_label: string
  turn_state: 'idle' | 'running'
  session: RuntimeSession
}

export interface DesktopSearchHit {
  session_id: string
  title: string
  project_name: string
  project_path: string
  bucket: 'today' | 'yesterday' | 'older'
  preview: string
  snippet: string
  updated_at: number
}

export interface DesktopCustomizeSummary {
  loaded_config_count: number
  mcp_server_count: number
  plugin_count: number
  enabled_plugin_count: number
  plugin_tool_count: number
  pre_tool_hook_count: number
  post_tool_hook_count: number
}

export interface DesktopConfigFile {
  source: string
  path: string
}

export interface DesktopHookConfigView {
  pre_tool_use: string[]
  post_tool_use: string[]
}

export interface DesktopMcpServer {
  name: string
  scope: string
  transport: string
  target: string
}

export interface DesktopPluginView {
  id: string
  name: string
  version: string
  description: string
  kind: string
  source: string
  root_path: string | null
  enabled: boolean
  default_enabled: boolean
  tool_count: number
  pre_tool_hook_count: number
  post_tool_hook_count: number
}

export interface DesktopCustomizeState {
  project_path: string
  model_id: string
  model_label: string
  permission_mode: string
  summary: DesktopCustomizeSummary
  loaded_configs: DesktopConfigFile[]
  hooks: DesktopHookConfigView
  mcp_servers: DesktopMcpServer[]
  plugins: DesktopPluginView[]
  warnings: string[]
}

export interface DesktopProviderSetting {
  id: string
  label: string
  base_url: string
  auth_status: string
}

export interface DesktopStorageLocation {
  label: string
  path: string
  description: string
}

export type DesktopScheduledTaskStatus = 'idle' | 'running'
export type DesktopScheduledRunStatus = 'success' | 'error'
export type DesktopScheduledTaskTargetKind = 'new_session' | 'existing_session'
export type DesktopWeekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export interface DesktopScheduledSummary {
  total_task_count: number
  enabled_task_count: number
  running_task_count: number
  blocked_task_count: number
  due_task_count: number
}

export interface DesktopScheduledTaskTarget {
  kind: DesktopScheduledTaskTargetKind
  session_id: string | null
  label: string
}

export type DesktopScheduledSchedule =
  | {
      kind: 'hourly'
      interval_hours: number
    }
  | {
      kind: 'weekly'
      days: DesktopWeekday[]
      hour: number
      minute: number
    }

export interface DesktopScheduledTask {
  id: string
  title: string
  prompt: string
  project_name: string
  project_path: string
  schedule: DesktopScheduledSchedule
  schedule_label: string
  target: DesktopScheduledTaskTarget
  enabled: boolean
  blocked_reason: string | null
  status: DesktopScheduledTaskStatus
  created_at: number
  updated_at: number
  last_run_at: number | null
  next_run_at: number | null
  last_run_status: DesktopScheduledRunStatus | null
  last_outcome: string | null
}

export interface DesktopScheduledState {
  project_path: string
  summary: DesktopScheduledSummary
  tasks: DesktopScheduledTask[]
  trusted_project_paths: string[]
  warnings: string[]
}

export type DesktopDispatchSourceKind = 'local_inbox' | 'remote_bridge' | 'scheduled'
export type DesktopDispatchTargetKind = 'new_session' | 'existing_session'
export type DesktopDispatchPriority = 'low' | 'normal' | 'high'
export type DesktopDispatchStatus =
  | 'unread'
  | 'read'
  | 'delivering'
  | 'delivered'
  | 'archived'
  | 'error'

export interface DesktopDispatchSummary {
  total_item_count: number
  unread_item_count: number
  pending_item_count: number
  delivered_item_count: number
  archived_item_count: number
}

export interface DesktopDispatchSource {
  kind: DesktopDispatchSourceKind
  label: string
}

export interface DesktopDispatchTarget {
  kind: DesktopDispatchTargetKind
  session_id: string | null
  label: string
}

export interface DesktopDispatchItem {
  id: string
  title: string
  body: string
  project_name: string
  project_path: string
  source: DesktopDispatchSource
  priority: DesktopDispatchPriority
  target: DesktopDispatchTarget
  status: DesktopDispatchStatus
  created_at: number
  updated_at: number
  delivered_at: number | null
  last_outcome: string | null
}

export interface DesktopDispatchState {
  project_path: string
  summary: DesktopDispatchSummary
  items: DesktopDispatchItem[]
  warnings: string[]
}

export interface DesktopSettingsState {
  project_path: string
  config_home: string
  desktop_session_store_path: string
  oauth_credentials_path: string | null
  providers: DesktopProviderSetting[]
  storage_locations: DesktopStorageLocation[]
  warnings: string[]
}

export interface DesktopSessionsResponse {
  sessions: DesktopSessionSummary[]
}

export interface DesktopCustomizeResponse {
  customize: DesktopCustomizeState
}

export interface DesktopScheduledResponse {
  scheduled: DesktopScheduledState
}

export interface DesktopScheduledTaskResponse {
  task: DesktopScheduledTask
}

export interface DesktopDispatchResponse {
  dispatch: DesktopDispatchState
}

export interface DesktopDispatchItemResponse {
  item: DesktopDispatchItem
}

export interface DesktopSettingsResponse {
  settings: DesktopSettingsState
}

export interface SearchDesktopSessionsResponse {
  results: DesktopSearchHit[]
}

export interface CreateDesktopSessionResponse {
  session: DesktopSessionDetail
}

export interface AppendDesktopMessageResponse {
  session: DesktopSessionDetail
}

export interface SessionEventSnapshot {
  type: 'snapshot'
  session: DesktopSessionDetail
}

export interface SessionEventMessage {
  type: 'message'
  session_id: string
  message: ConversationMessage
}

export type SessionEvent = SessionEventSnapshot | SessionEventMessage
