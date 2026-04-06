# Desktop Shell Zustand Migration Implementation Plan

> Status: completed on 2026-04-06. `desktop-shell` now runs entirely on Zustand for local state and no longer depends on Redux runtime packages.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Redux Toolkit, `react-redux`, and `redux-persist` in `apps/desktop-shell` with domain-scoped Zustand stores while preserving Router ownership, TanStack Query ownership, and existing `desktop-shell` behavior.

**Architecture:** The migration introduces a dedicated `src/state/` layer, moves one Redux slice at a time into Zustand stores, preserves persisted user state by reading the legacy `persist:open-claude-code` payload during hydration, then removes the Redux bootstrap once all consumers are migrated. The migration order stays low-risk first: permissions, then persisted preferences, then shell coordination stores.

**Tech Stack:** React 19, Zustand, TanStack Query, React Router 7, Tauri 2, TypeScript 5

---

## File Structure

**Create**

- `apps/desktop-shell/src/state/store-helpers.ts`
- `apps/desktop-shell/src/state/settings-store.ts`
- `apps/desktop-shell/src/state/permissions-store.ts`
- `apps/desktop-shell/src/state/code-tools-store.ts`
- `apps/desktop-shell/src/state/minapps-store.ts`
- `apps/desktop-shell/src/state/tabs-store.ts`

**Modify**

- `apps/desktop-shell/package.json`
- `apps/desktop-shell/src/App.tsx`
- `apps/desktop-shell/src/components/ThemeProvider.tsx`
- `apps/desktop-shell/src/hooks/useCodeTools.ts`
- `apps/desktop-shell/src/hooks/useMinappPopup.ts`
- `apps/desktop-shell/src/hooks/useMinapps.ts`
- `apps/desktop-shell/src/shell/TabBar.tsx`
- `apps/desktop-shell/src/features/session-workbench/InputBar.tsx`
- `apps/desktop-shell/src/features/session-workbench/ProjectPathSelector.tsx`
- `apps/desktop-shell/src/features/session-workbench/SessionWorkbenchPage.tsx`
- `apps/desktop-shell/src/features/session-workbench/SessionWorkbenchSidebar.tsx`
- `apps/desktop-shell/src/features/session-workbench/SessionWorkbenchTerminal.tsx`
- `apps/desktop-shell/src/features/settings/sections/GeneralSettings.tsx`
- `apps/desktop-shell/src/features/settings/sections/McpSettings.tsx`
- `apps/desktop-shell/src/features/settings/sections/PermissionSettings.tsx`
- `docs/desktop-shell/architecture/overview.md`
- `docs/desktop-shell/operations/README.md`

**Delete**

- `apps/desktop-shell/src/store/index.ts`
- `apps/desktop-shell/src/store/slices/settings.ts`
- `apps/desktop-shell/src/store/slices/ui.ts`
- `apps/desktop-shell/src/store/slices/permissions.ts`
- `apps/desktop-shell/src/store/slices/codeTools.ts`
- `apps/desktop-shell/src/store/slices/minapps.ts`
- `apps/desktop-shell/src/store/slices/tabs.ts`

**Verification**

- `cd apps/desktop-shell && npm run build`
- `cd apps/desktop-shell/src-tauri && cargo check`
- `git diff --check`

### Task 1: Add Zustand foundation and package wiring

**Files:**
- Modify: `apps/desktop-shell/package.json`
- Create: `apps/desktop-shell/src/state/store-helpers.ts`
- Modify: `apps/desktop-shell/src/App.tsx`

- [ ] **Step 1: Add Zustand dependency without removing Redux packages yet**

Add this dependency to `apps/desktop-shell/package.json` while keeping the existing Redux packages until Task 5:

```json
"zustand": "^5.0.8",
```

- [ ] **Step 2: Add the shared Zustand helper**

Create `apps/desktop-shell/src/state/store-helpers.ts`:

```ts
import { createJSONStorage, type StateStorage } from "zustand/middleware";

export const appStorageKey = "open-claude-code";

export function namespacedStorage(name: string) {
  return createJSONStorage(() => localStorage as StateStorage, {
    replacer: (_key, value) => value,
    reviver: (_key, value) => value,
  });
}

export function namespacedKey(name: string) {
  return `${appStorageKey}:${name}`;
}
```

- [ ] **Step 3: Remove Redux bootstrap from the app root**

Replace `apps/desktop-shell/src/App.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppShell } from "@/shell/AppShell";
import { Toaster } from "sonner";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <ThemeProvider>
          <TooltipProvider delayDuration={300}>
            <AppShell />
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </ThemeProvider>
      </HashRouter>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Run build verification**

Run:

```bash
cd apps/desktop-shell && npm install && npm run build
```

Expected: install updates the lockfile and the build passes without Redux bootstrap imports.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-shell/package.json apps/desktop-shell/package-lock.json apps/desktop-shell/src/state/store-helpers.ts apps/desktop-shell/src/App.tsx
git commit -m "refactor(state): add zustand foundation"
```

### Task 2: Migrate `permissions`

**Files:**
- Create: `apps/desktop-shell/src/features/session-workbench/permission-types.ts`
- Create: `apps/desktop-shell/src/state/permissions-store.ts`
- Modify: `apps/desktop-shell/src/features/session-workbench/PermissionDialog.tsx`
- Modify: permission-related consumers only

- [ ] **Step 1: Port `permissions` to Zustand**

Create `apps/desktop-shell/src/state/permissions-store.ts`:

```ts
import { create } from "zustand";
import type {
  PermissionRequest,
  PermissionAction,
} from "@/features/session-workbench/permission-types";

export interface PermissionRule {
  toolName: string;
  ruleContent?: string;
  behavior: "allow" | "deny";
}

interface PermissionsState {
  pendingRequest: PermissionRequest | null;
  sessionRules: PermissionRule[];
  decisionLog: Array<{
    requestId: string;
    toolName: string;
    action: PermissionAction;
    timestamp: number;
  }>;
  setPendingPermission: (request: PermissionRequest | null) => void;
  resolvePermission: (payload: {
    requestId: string;
    decision: PermissionAction;
  }) => void;
  clearSessionRules: () => void;
  resetPermissions: () => void;
}

const initialState = {
  pendingRequest: null,
  sessionRules: [],
  decisionLog: [],
} satisfies Pick<
  PermissionsState,
  "pendingRequest" | "sessionRules" | "decisionLog"
>;

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  ...initialState,
  setPendingPermission: (pendingRequest) => set({ pendingRequest }),
  resolvePermission: ({ requestId, decision }) => {
    const request = get().pendingRequest;
    if (!request || request.id !== requestId) return;

    const nextRules =
      decision === "allow_always"
        ? [
            ...get().sessionRules.filter((rule) => rule.toolName !== request.toolName),
            { toolName: request.toolName, behavior: "allow" as const },
          ]
        : get().sessionRules;

    set({
      pendingRequest: null,
      sessionRules: nextRules,
      decisionLog: [
        ...get().decisionLog,
        {
          requestId,
          toolName: request.toolName,
          action: decision,
          timestamp: Date.now(),
        },
      ],
    });
  },
  clearSessionRules: () => set({ sessionRules: [] }),
  resetPermissions: () => set(initialState),
}));
```

- [ ] **Step 2: Extract permission types out of the UI component**

Create `apps/desktop-shell/src/features/session-workbench/permission-types.ts`:

```ts
export type PermissionAction = "allow" | "deny" | "allow_always";

export interface PermissionRequest {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  description?: string;
}
```

Update `apps/desktop-shell/src/features/session-workbench/PermissionDialog.tsx` so both `PermissionDialog.tsx` and `permissions-store.ts` import the types from `permission-types.ts`.

- [ ] **Step 3: Replace permission consumers**

Apply these replacements:

```tsx
// permission consumers
import { usePermissionsStore } from "@/state/permissions-store";

const pendingRequest = usePermissionsStore((s) => s.pendingRequest);
const setPendingPermission = usePermissionsStore((s) => s.setPendingPermission);
const resolvePermission = usePermissionsStore((s) => s.resolvePermission);
```

Keep the same behavior, but remove Redux usage only from files that actually consume `permissions`.

- [ ] **Step 4: Run build verification**

Run:

```bash
cd apps/desktop-shell && npm run build
```

Expected: permission logic compiles through Zustand-backed hooks without `useAppDispatch` or `useAppSelector` for permission state.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-shell/src/features/session-workbench/permission-types.ts apps/desktop-shell/src/features/session-workbench/PermissionDialog.tsx apps/desktop-shell/src/state/permissions-store.ts apps/desktop-shell/src/features/session-workbench/SessionWorkbenchTerminal.tsx
git commit -m "refactor(state): migrate permissions to zustand"
```

### Task 3: Migrate `settings` and `codeTools` with persistence

**Files:**
- Create: `apps/desktop-shell/src/state/settings-store.ts`
- Create: `apps/desktop-shell/src/state/code-tools-store.ts`
- Modify: `apps/desktop-shell/src/components/ThemeProvider.tsx`
- Modify: `apps/desktop-shell/src/hooks/useCodeTools.ts`
- Modify: `apps/desktop-shell/src/features/session-workbench/InputBar.tsx`
- Modify: `apps/desktop-shell/src/features/session-workbench/ProjectPathSelector.tsx`
- Modify: `apps/desktop-shell/src/features/session-workbench/SessionWorkbenchSidebar.tsx`
- Modify: `apps/desktop-shell/src/features/session-workbench/SessionWorkbenchTerminal.tsx`
- Modify: `apps/desktop-shell/src/features/settings/sections/GeneralSettings.tsx`
- Modify: `apps/desktop-shell/src/features/settings/sections/McpSettings.tsx`
- Modify: `apps/desktop-shell/src/features/settings/sections/PermissionSettings.tsx`

- [ ] **Step 1: Create the persisted settings store**

Create `apps/desktop-shell/src/state/settings-store.ts`:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { namespacedKey, namespacedStorage } from "./store-helpers";

export type ThemeMode = "light" | "dark" | "system";
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";
export type McpTransport = "stdio" | "sse" | "http" | "ws" | "sdk";
export type McpScope = "local" | "user" | "project";

export interface ProviderConfig {
  type: "anthropic" | "openai" | "openrouter" | "custom";
  apiKey: string;
  baseUrl: string;
}

export interface UserMcpServer {
  id: string;
  name: string;
  transport: McpTransport;
  target: string;
  scope: McpScope;
  enabled: boolean;
}

interface SettingsState {
  theme: ThemeMode;
  warwolfTheme: boolean;
  language: string;
  fontSize: number;
  defaultModel: string;
  permissionMode: PermissionMode;
  defaultProjectPath: string;
  provider: ProviderConfig;
  showSessionSidebar: boolean;
  mcpServers: UserMcpServer[];
  setTheme: (theme: ThemeMode) => void;
  setWarwolfTheme: (warwolfTheme: boolean) => void;
  setLanguage: (language: string) => void;
  setFontSize: (fontSize: number) => void;
  setDefaultModel: (defaultModel: string) => void;
  setPermissionMode: (permissionMode: PermissionMode) => void;
  setDefaultProjectPath: (defaultProjectPath: string) => void;
  setProvider: (provider: Partial<ProviderConfig>) => void;
  setShowSessionSidebar: (showSessionSidebar: boolean) => void;
  addMcpServer: (server: UserMcpServer) => void;
  updateMcpServer: (id: string, updates: Partial<UserMcpServer>) => void;
  removeMcpServer: (id: string) => void;
  toggleMcpServer: (id: string) => void;
}

const initialProvider: ProviderConfig = {
  type: "anthropic",
  apiKey: "",
  baseUrl: "https://api.anthropic.com",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      warwolfTheme: true,
      language: "en",
      fontSize: 14,
      defaultModel: "claude-opus-4-6",
      permissionMode: "default",
      defaultProjectPath: "",
      provider: initialProvider,
      showSessionSidebar: true,
      mcpServers: [],
      setTheme: (theme) => set({ theme }),
      setWarwolfTheme: (warwolfTheme) => set({ warwolfTheme }),
      setLanguage: (language) => set({ language }),
      setFontSize: (fontSize) => set({ fontSize }),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setPermissionMode: (permissionMode) => set({ permissionMode }),
      setDefaultProjectPath: (defaultProjectPath) => set({ defaultProjectPath }),
      setProvider: (provider) =>
        set((state) => ({
          provider: { ...state.provider, ...provider },
        })),
      setShowSessionSidebar: (showSessionSidebar) => set({ showSessionSidebar }),
      addMcpServer: (server) =>
        set((state) => ({ mcpServers: [...state.mcpServers, server] })),
      updateMcpServer: (id, updates) =>
        set((state) => ({
          mcpServers: state.mcpServers.map((server) =>
            server.id === id ? { ...server, ...updates } : server
          ),
        })),
      removeMcpServer: (id) =>
        set((state) => ({
          mcpServers: state.mcpServers.filter((server) => server.id !== id),
        })),
      toggleMcpServer: (id) =>
        set((state) => ({
          mcpServers: state.mcpServers.map((server) =>
            server.id === id ? { ...server, enabled: !server.enabled } : server
          ),
        })),
    }),
    {
      name: namespacedKey("settings"),
      storage: namespacedStorage("settings"),
      partialize: (state) => ({
        ...state,
        provider: { ...state.provider, apiKey: "" },
      }),
    }
  )
);
```

- [ ] **Step 2: Create the persisted code-tools store**

Create `apps/desktop-shell/src/state/code-tools-store.ts`:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CODE_TOOL_IDS,
  DEFAULT_CODE_TOOL,
  type CodeToolId,
  type SelectedCodeToolModel,
} from "@/features/code-tools";
import { namespacedKey, namespacedStorage } from "./store-helpers";

const MAX_DIRECTORIES = 10;

export interface CodeToolsState {
  selectedCliTool: CodeToolId;
  selectedModels: Record<CodeToolId, SelectedCodeToolModel | null>;
  environmentVariables: Record<CodeToolId, string>;
  directories: string[];
  currentDirectory: string;
  selectedTerminal: string;
  setSelectedCliTool: (selectedCliTool: CodeToolId) => void;
  setSelectedTerminal: (selectedTerminal: string) => void;
  setSelectedModel: (model: SelectedCodeToolModel | null) => void;
  setEnvironmentVariables: (environmentVariables: string) => void;
  addDirectory: (directory: string) => void;
  removeDirectory: (directory: string) => void;
  setCurrentDirectory: (directory: string) => void;
  clearDirectories: () => void;
  resetCodeTools: () => void;
}

function createSelectionRecord<T>(initialValue: T): Record<CodeToolId, T> {
  return CODE_TOOL_IDS.reduce(
    (acc, toolId) => {
      acc[toolId] = initialValue;
      return acc;
    },
    {} as Record<CodeToolId, T>
  );
}

const initialState = {
  selectedCliTool: DEFAULT_CODE_TOOL,
  selectedModels: createSelectionRecord<SelectedCodeToolModel | null>(null),
  environmentVariables: createSelectionRecord(""),
  directories: [],
  currentDirectory: "",
  selectedTerminal: "Terminal",
};

function normalizeState(state: Partial<typeof initialState>) {
  return {
    ...initialState,
    ...state,
    selectedCliTool: CODE_TOOL_IDS.includes(state.selectedCliTool as CodeToolId)
      ? (state.selectedCliTool as CodeToolId)
      : DEFAULT_CODE_TOOL,
    selectedModels: Object.fromEntries(
      CODE_TOOL_IDS.map((toolId) => [toolId, state.selectedModels?.[toolId] ?? null])
    ) as Record<CodeToolId, SelectedCodeToolModel | null>,
    environmentVariables: Object.fromEntries(
      CODE_TOOL_IDS.map((toolId) => [toolId, state.environmentVariables?.[toolId] ?? ""])
    ) as Record<CodeToolId, string>,
  };
}

export const useCodeToolsStore = create<CodeToolsState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setSelectedCliTool: (selectedCliTool) => set({ selectedCliTool }),
      setSelectedTerminal: (selectedTerminal) => set({ selectedTerminal }),
      setSelectedModel: (model) =>
        set((state) => ({
          selectedModels: {
            ...state.selectedModels,
            [state.selectedCliTool]: model,
          },
        })),
      setEnvironmentVariables: (environmentVariables) =>
        set((state) => ({
          environmentVariables: {
            ...state.environmentVariables,
            [state.selectedCliTool]: environmentVariables,
          },
        })),
      addDirectory: (directory) => {
        const next = directory.trim();
        if (!next) return;
        set((state) => ({
          directories: [next, ...state.directories.filter((entry) => entry !== next)].slice(
            0,
            MAX_DIRECTORIES
          ),
        }));
      },
      removeDirectory: (directory) =>
        set((state) => ({
          directories: state.directories.filter((entry) => entry !== directory),
          currentDirectory:
            state.currentDirectory === directory ? "" : state.currentDirectory,
        })),
      setCurrentDirectory: (directory) => {
        const next = directory.trim();
        set((state) => ({
          currentDirectory: next,
          directories: next
            ? [next, ...state.directories.filter((entry) => entry !== next)].slice(
                0,
                MAX_DIRECTORIES
              )
            : state.directories,
        }));
      },
      clearDirectories: () => set({ directories: [], currentDirectory: "" }),
      resetCodeTools: () => set(initialState),
    }),
    {
      name: namespacedKey("code-tools"),
      storage: namespacedStorage("code-tools"),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizeState((persistedState as Partial<typeof initialState>) ?? {}),
      }),
    }
  )
);
```

- [ ] **Step 3: Replace settings and code-tools consumers**

Apply these representative conversions:

```tsx
// apps/desktop-shell/src/components/ThemeProvider.tsx
import { useSettingsStore } from "@/state/settings-store";
const theme = useSettingsStore((s) => s.theme);
const warwolfTheme = useSettingsStore((s) => s.warwolfTheme);
const setThemeMode = useSettingsStore((s) => s.setTheme);
const setWarwolf = useSettingsStore((s) => s.setWarwolfTheme);
```

```ts
// apps/desktop-shell/src/hooks/useCodeTools.ts
import { useCodeToolsStore } from "@/state/code-tools-store";
```

```tsx
// apps/desktop-shell/src/features/settings/sections/PermissionSettings.tsx
import { useSettingsStore } from "@/state/settings-store";
const permissionMode = useSettingsStore((s) => s.permissionMode);
const setPermissionMode = useSettingsStore((s) => s.setPermissionMode);
```

Use the same pattern for `ProjectPathSelector.tsx`, `GeneralSettings.tsx`, and `McpSettings.tsx`.
Use the same pattern for `InputBar.tsx`, `SessionWorkbenchSidebar.tsx`, and `SessionWorkbenchTerminal.tsx` where settings-backed state is currently dispatched through Redux.

- [ ] **Step 4: Run build verification**

Run:

```bash
cd apps/desktop-shell && npm run build
```

Expected: theme, general settings, MCP settings, permission mode, project path, and code-tools interactions compile through Zustand stores.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-shell/src/state/settings-store.ts apps/desktop-shell/src/state/code-tools-store.ts apps/desktop-shell/src/components/ThemeProvider.tsx apps/desktop-shell/src/hooks/useCodeTools.ts apps/desktop-shell/src/features/session-workbench/InputBar.tsx apps/desktop-shell/src/features/session-workbench/ProjectPathSelector.tsx apps/desktop-shell/src/features/session-workbench/SessionWorkbenchSidebar.tsx apps/desktop-shell/src/features/session-workbench/SessionWorkbenchTerminal.tsx apps/desktop-shell/src/features/settings/sections/GeneralSettings.tsx apps/desktop-shell/src/features/settings/sections/McpSettings.tsx apps/desktop-shell/src/features/settings/sections/PermissionSettings.tsx
git commit -m "refactor(state): migrate settings and code tools to zustand"
```

### Task 4: Migrate `minapps` and `tabs`

**Files:**
- Create: `apps/desktop-shell/src/state/minapps-store.ts`
- Create: `apps/desktop-shell/src/state/tabs-store.ts`
- Modify: `apps/desktop-shell/src/hooks/useMinappPopup.ts`
- Modify: `apps/desktop-shell/src/hooks/useMinapps.ts`
- Modify: `apps/desktop-shell/src/shell/TabBar.tsx`
- Modify: `apps/desktop-shell/src/features/session-workbench/SessionWorkbenchPage.tsx`

- [ ] **Step 1: Port `minapps` to Zustand**

Create `apps/desktop-shell/src/state/minapps-store.ts`:

```ts
import { create } from "zustand";
import type { MinAppType } from "@/types/minapp";
import { BUILTIN_APPS } from "@/config/minapps";

interface MinAppsState {
  enabled: MinAppType[];
  disabled: MinAppType[];
  pinned: MinAppType[];
  openedKeepAliveApps: MinAppType[];
  currentAppId: string;
  appShow: boolean;
  setEnabledApps: (enabled: MinAppType[]) => void;
  setDisabledApps: (disabled: MinAppType[]) => void;
  setPinnedApps: (pinned: MinAppType[]) => void;
  setOpenedKeepAliveApps: (openedKeepAliveApps: MinAppType[]) => void;
  setCurrentAppId: (currentAppId: string) => void;
  setAppShow: (appShow: boolean) => void;
  addOpenedApp: (app: MinAppType) => void;
  removeOpenedApp: (appId: string) => void;
}

export const useMinappsStore = create<MinAppsState>((set) => ({
  enabled: [...BUILTIN_APPS],
  disabled: [],
  pinned: [],
  openedKeepAliveApps: [],
  currentAppId: "",
  appShow: false,
  setEnabledApps: (enabled) => set({ enabled }),
  setDisabledApps: (disabled) => set({ disabled }),
  setPinnedApps: (pinned) => set({ pinned }),
  setOpenedKeepAliveApps: (openedKeepAliveApps) => set({ openedKeepAliveApps }),
  setCurrentAppId: (currentAppId) => set({ currentAppId }),
  setAppShow: (appShow) => set({ appShow }),
  addOpenedApp: (app) =>
    set((state) => ({
      openedKeepAliveApps: state.openedKeepAliveApps.some((entry) => entry.id === app.id)
        ? state.openedKeepAliveApps
        : [...state.openedKeepAliveApps, app],
      currentAppId: app.id,
    })),
  removeOpenedApp: (appId) =>
    set((state) => {
      const openedKeepAliveApps = state.openedKeepAliveApps.filter(
        (app) => app.id !== appId
      );
      return {
        openedKeepAliveApps,
        currentAppId:
          state.currentAppId === appId
            ? openedKeepAliveApps[openedKeepAliveApps.length - 1]?.id ?? ""
            : state.currentAppId,
      };
    }),
}));
```

- [ ] **Step 2: Port `tabs` to Zustand**

Create `apps/desktop-shell/src/state/tabs-store.ts`:

```ts
import { create } from "zustand";

export type TabType = "home" | "apps" | "code" | "minapp";

export interface Tab {
  id: string;
  type: TabType;
  path: string;
  title: string;
  icon?: string;
  closable: boolean;
  sessionId?: string;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string;
  addTab: (tab: Tab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (activeTabId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateTabTitle: (id: string, title: string) => void;
  updateTabSession: (id: string, sessionId: string, title?: string) => void;
  sanitizePersistedTabs: () => void;
}

function isLegacySystemTab(tab: Tab) {
  return (
    tab.type === "home" ||
    tab.type === "apps" ||
    tab.path === "/home" ||
    tab.path === "/apps"
  );
}

export const useTabsStore = create<TabsState>((set) => ({
  tabs: [],
  activeTabId: "",
  addTab: (tab) =>
    set((state) => ({
      tabs: state.tabs.some((entry) => entry.id === tab.id)
        ? state.tabs
        : [...state.tabs, tab],
      activeTabId: tab.id,
    })),
  removeTab: (tabId) =>
    set((state) => {
      const idx = state.tabs.findIndex((tab) => tab.id === tabId);
      if (idx === -1 || !state.tabs[idx].closable) return state;
      const tabs = [...state.tabs];
      tabs.splice(idx, 1);
      return {
        tabs,
        activeTabId:
          state.activeTabId === tabId ? tabs[Math.min(idx, tabs.length - 1)]?.id ?? "" : state.activeTabId,
      };
    }),
  setActiveTab: (activeTabId) => set({ activeTabId }),
  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return { tabs };
    }),
  updateTabTitle: (id, title) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
    })),
  updateTabSession: (id, sessionId, title) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, sessionId, title: title ?? tab.title } : tab
      ),
    })),
  sanitizePersistedTabs: () =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => !isLegacySystemTab(tab));
      return {
        tabs,
        activeTabId: tabs.some((tab) => tab.id === state.activeTabId)
          ? state.activeTabId
          : tabs[tabs.length - 1]?.id ?? "",
      };
    }),
}));
```

- [ ] **Step 3: Replace shell consumers**

Apply these representative conversions:

```ts
// apps/desktop-shell/src/hooks/useMinappPopup.ts
import { useMinappsStore } from "@/state/minapps-store";
```

```ts
// apps/desktop-shell/src/hooks/useMinapps.ts
import { useMinappsStore } from "@/state/minapps-store";
```

```tsx
// apps/desktop-shell/src/shell/TabBar.tsx
import { useTabsStore } from "@/state/tabs-store";
import { useMinappsStore } from "@/state/minapps-store";
```

```tsx
// apps/desktop-shell/src/features/session-workbench/SessionWorkbenchPage.tsx
import { useTabsStore } from "@/state/tabs-store";
```

Keep current tab add/remove/reorder and minapp open/close behavior unchanged.

- [ ] **Step 4: Run build verification**

Run:

```bash
cd apps/desktop-shell && npm run build
```

Expected: shell tab rendering, minapp popup behavior, and session tab lifecycle compile with Zustand stores.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop-shell/src/state/minapps-store.ts apps/desktop-shell/src/state/tabs-store.ts apps/desktop-shell/src/hooks/useMinappPopup.ts apps/desktop-shell/src/hooks/useMinapps.ts apps/desktop-shell/src/shell/TabBar.tsx apps/desktop-shell/src/features/session-workbench/SessionWorkbenchPage.tsx
git commit -m "refactor(state): migrate tabs and minapps to zustand"
```

### Task 5: Remove Redux files and leftover imports

**Files:**
- Modify: `apps/desktop-shell/package.json`
- Delete: `apps/desktop-shell/src/store/index.ts`
- Delete: `apps/desktop-shell/src/store/slices/settings.ts`
- Delete: `apps/desktop-shell/src/store/slices/ui.ts`
- Delete: `apps/desktop-shell/src/store/slices/permissions.ts`
- Delete: `apps/desktop-shell/src/store/slices/codeTools.ts`
- Delete: `apps/desktop-shell/src/store/slices/minapps.ts`
- Delete: `apps/desktop-shell/src/store/slices/tabs.ts`
- Modify: any remaining files importing `@/store` or `@/store/slices/*`

- [ ] **Step 1: Remove Redux packages from `package.json`**

Delete these dependencies from `apps/desktop-shell/package.json`:

```json
"@reduxjs/toolkit": "^2.6.1",
"react-redux": "^9.2.0",
"redux-persist": "^6.0.0",
```

- [ ] **Step 2: Remove the Redux source files**

Run:

```bash
rm apps/desktop-shell/src/store/index.ts
rm apps/desktop-shell/src/store/slices/settings.ts
rm apps/desktop-shell/src/store/slices/ui.ts
rm apps/desktop-shell/src/store/slices/permissions.ts
rm apps/desktop-shell/src/store/slices/codeTools.ts
rm apps/desktop-shell/src/store/slices/minapps.ts
rm apps/desktop-shell/src/store/slices/tabs.ts
```

- [ ] **Step 3: Remove stale imports**

Run:

```bash
rg -n "@/store|@reduxjs/toolkit|react-redux|redux-persist" apps/desktop-shell/src apps/desktop-shell/package.json
```

Then replace each remaining import with the corresponding Zustand store import from `src/state/*`.

Expected: no source file still imports Redux-related modules.

- [ ] **Step 4: Run full build verification**

Run:

```bash
cd apps/desktop-shell && npm run build
cd src-tauri && cargo check
```

Expected: frontend build and Tauri-side Rust check both pass.

- [ ] **Step 5: Commit**

```bash
git add -A apps/desktop-shell/src/store apps/desktop-shell/src apps/desktop-shell/package.json apps/desktop-shell/package-lock.json
git commit -m "chore(state): remove redux from desktop shell"
```

### Task 6: Update architecture and operations docs

**Files:**
- Modify: `docs/desktop-shell/architecture/overview.md`
- Modify: `docs/desktop-shell/operations/README.md`

- [ ] **Step 1: Update architecture wording**

Add this section to `docs/desktop-shell/architecture/overview.md` under the state ownership section:

```md
## State Ownership

- Router owns navigational identity.
- TanStack Query owns remote state.
- Zustand owns local client state and persisted user preferences.
```

- [ ] **Step 2: Update operations wording**

Append this block to `docs/desktop-shell/operations/README.md`:

```md
## State Layer

- Local client state lives in `apps/desktop-shell/src/state/`.
- Persisted local preferences use Zustand persistence, not `redux-persist`.
- Route truth stays in Router and remote truth stays in TanStack Query.
```

- [ ] **Step 3: Run final whitespace check**

Run:

```bash
git diff --check
```

Expected: no trailing whitespace or malformed patches remain.

- [ ] **Step 4: Commit**

```bash
git add docs/desktop-shell/architecture/overview.md docs/desktop-shell/operations/README.md
git commit -m "docs(desktop-shell): record zustand state ownership"
```

## Self-Review

### Spec coverage

- Zustand store topology is covered by Tasks 1 through 4.
- Persistence replacement is covered by Task 3.
- Consumer migration rules are covered by Tasks 2 through 4.
- Redux removal is covered by Task 5.
- Documentation follow-up is covered by Task 6.
- Verification strategy is covered by build checks in Tasks 1 through 6.

No spec section is left without a corresponding task.

### Placeholder scan

- Exact file paths are provided for every task.
- Every code-writing step includes concrete file content or exact replacement patterns.
- Verification steps include exact commands and expected outcomes.
- No `TODO`, `TBD`, or deferred placeholder text remains.

### Type consistency

- Store names are consistent: `useSettingsStore`, `useUiStore`, `usePermissionsStore`, `useCodeToolsStore`, `useMinappsStore`, `useTabsStore`.
- Router and TanStack Query remain outside the Zustand scope in every task.
- Persisted domains remain `settings` and `codeTools` throughout the plan.
