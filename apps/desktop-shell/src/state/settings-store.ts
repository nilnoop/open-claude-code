import { create } from "zustand";
import { persist } from "zustand/middleware";
import { namespacedStorage, readLegacyPersistedSlice } from "./store-helpers";

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

export interface SettingsState {
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
  setWarwolfTheme: (enabled: boolean) => void;
  setLanguage: (language: string) => void;
  setFontSize: (fontSize: number) => void;
  setDefaultModel: (model: string) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setDefaultProjectPath: (path: string) => void;
  setProvider: (provider: Partial<ProviderConfig>) => void;
  setShowSessionSidebar: (show: boolean) => void;
  updateSettings: (
    updates: Partial<
      Pick<
        SettingsState,
        | "theme"
        | "warwolfTheme"
        | "language"
        | "fontSize"
        | "defaultModel"
        | "permissionMode"
        | "defaultProjectPath"
        | "provider"
        | "showSessionSidebar"
        | "mcpServers"
      >
    >
  ) => void;
  addMcpServer: (server: UserMcpServer) => void;
  updateMcpServer: (payload: {
    id: string;
    updates: Partial<UserMcpServer>;
  }) => void;
  removeMcpServer: (id: string) => void;
  toggleMcpServer: (id: string) => void;
}

type PersistedSettingsState = Pick<
  SettingsState,
  | "theme"
  | "warwolfTheme"
  | "language"
  | "fontSize"
  | "defaultModel"
  | "permissionMode"
  | "defaultProjectPath"
  | "provider"
  | "showSessionSidebar"
  | "mcpServers"
>;

const defaultSettingsState: PersistedSettingsState = {
  theme: "system",
  warwolfTheme: true,
  language: "en",
  fontSize: 14,
  defaultModel: "claude-opus-4-6",
  permissionMode: "default",
  defaultProjectPath: "",
  provider: {
    type: "anthropic",
    apiKey: "",
    baseUrl: "https://api.anthropic.com",
  },
  showSessionSidebar: true,
  mcpServers: [],
};

function sanitizeProviderConfig(provider: ProviderConfig) {
  return {
    ...provider,
    apiKey: "",
  };
}

function mergeSettingsState(
  base: PersistedSettingsState,
  persisted?: Partial<PersistedSettingsState> | null
): PersistedSettingsState {
  if (!persisted) {
    return base;
  }

  return {
    ...base,
    ...persisted,
    provider: {
      ...base.provider,
      ...(persisted.provider ?? {}),
    },
    mcpServers: persisted.mcpServers ?? base.mcpServers,
  };
}

function createInitialSettingsState() {
  return mergeSettingsState(
    defaultSettingsState,
    readLegacyPersistedSlice<Partial<PersistedSettingsState>>("settings")
  );
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...createInitialSettingsState(),
      setTheme: (theme) => set({ theme }),
      setWarwolfTheme: (warwolfTheme) => set({ warwolfTheme }),
      setLanguage: (language) => set({ language }),
      setFontSize: (fontSize) => set({ fontSize }),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setPermissionMode: (permissionMode) => set({ permissionMode }),
      setDefaultProjectPath: (defaultProjectPath) => set({ defaultProjectPath }),
      setProvider: (provider) =>
        set((state) => ({
          provider: {
            ...state.provider,
            ...provider,
          },
        })),
      setShowSessionSidebar: (showSessionSidebar) => set({ showSessionSidebar }),
      updateSettings: (updates) =>
        set((state) => ({
          ...updates,
          provider: updates.provider
            ? {
                ...state.provider,
                ...updates.provider,
              }
            : state.provider,
          mcpServers: updates.mcpServers ?? state.mcpServers,
        })),
      addMcpServer: (server) =>
        set((state) => ({
          mcpServers: [...state.mcpServers, server],
        })),
      updateMcpServer: ({ id, updates }) =>
        set((state) => ({
          mcpServers: state.mcpServers.map((server) =>
            server.id === id
              ? {
                  ...server,
                  ...updates,
                }
              : server
          ),
        })),
      removeMcpServer: (id) =>
        set((state) => ({
          mcpServers: state.mcpServers.filter((server) => server.id !== id),
        })),
      toggleMcpServer: (id) =>
        set((state) => ({
          mcpServers: state.mcpServers.map((server) =>
            server.id === id
              ? {
                  ...server,
                  enabled: !server.enabled,
                }
              : server
          ),
        })),
    }),
    {
      name: "state",
      storage: namespacedStorage("settings"),
      partialize: (state) => ({
        theme: state.theme,
        warwolfTheme: state.warwolfTheme,
        language: state.language,
        fontSize: state.fontSize,
        defaultModel: state.defaultModel,
        permissionMode: state.permissionMode,
        defaultProjectPath: state.defaultProjectPath,
        provider: sanitizeProviderConfig(state.provider),
        showSessionSidebar: state.showSessionSidebar,
        mcpServers: state.mcpServers,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...mergeSettingsState(
          defaultSettingsState,
          persistedState as Partial<PersistedSettingsState> | null
        ),
      }),
    }
  )
);
