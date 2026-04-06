import { create } from "zustand";
import { persist } from "zustand/middleware";
import { namespacedStorage, readLegacyPersistedSlice } from "./store-helpers";

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

export interface TabsState {
  tabs: Tab[];
  activeTabId: string;
  addTab: (tab: Tab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  reorderTabs: (payload: { fromIndex: number; toIndex: number }) => void;
  updateTabTitle: (payload: { id: string; title: string }) => void;
  updateTabSession: (payload: {
    id: string;
    sessionId: string;
    title?: string;
  }) => void;
}

type PersistedTabsState = Pick<TabsState, "tabs" | "activeTabId">;

const defaultTabsState: PersistedTabsState = {
  tabs: [],
  activeTabId: "",
};

function isLegacySystemTab(tab: Tab) {
  return (
    tab.type === "home" ||
    tab.type === "apps" ||
    tab.path === "/home" ||
    tab.path === "/apps"
  );
}

function ensureTabs(tabs: unknown) {
  return Array.isArray(tabs)
    ? tabs.filter((tab): tab is Tab => Boolean(tab && typeof tab === "object"))
    : defaultTabsState.tabs;
}

function normalizeTabsState(
  persisted?: Partial<PersistedTabsState> | null
): PersistedTabsState {
  if (!persisted) {
    return defaultTabsState;
  }

  const tabs = ensureTabs(persisted.tabs).filter((tab) => !isLegacySystemTab(tab));
  const activeTabId =
    typeof persisted.activeTabId === "string" &&
    tabs.some((tab) => tab.id === persisted.activeTabId)
      ? persisted.activeTabId
      : tabs[tabs.length - 1]?.id ?? "";

  return {
    tabs,
    activeTabId,
  };
}

function createInitialTabsState() {
  return normalizeTabsState(
    readLegacyPersistedSlice<Partial<PersistedTabsState>>("tabs")
  );
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set) => ({
      ...createInitialTabsState(),
      addTab: (tab) =>
        set((state) => ({
          tabs: state.tabs.some((existingTab) => existingTab.id === tab.id)
            ? state.tabs
            : [...state.tabs, tab],
          activeTabId: tab.id,
        })),
      removeTab: (tabId) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.id === tabId);

          if (index === -1) {
            return state;
          }

          const tab = state.tabs[index];

          if (!tab.closable) {
            return state;
          }

          const tabs = state.tabs.filter((currentTab) => currentTab.id !== tabId);

          return {
            tabs,
            activeTabId:
              state.activeTabId === tabId
                ? tabs[Math.min(index, tabs.length - 1)]?.id ?? ""
                : state.activeTabId,
          };
        }),
      setActiveTab: (activeTabId) => set({ activeTabId }),
      reorderTabs: ({ fromIndex, toIndex }) =>
        set((state) => {
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= state.tabs.length ||
            toIndex >= state.tabs.length ||
            fromIndex === toIndex
          ) {
            return state;
          }

          const tabs = [...state.tabs];
          const [moved] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, moved);

          return { tabs };
        }),
      updateTabTitle: ({ id, title }) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  title,
                }
              : tab
          ),
        })),
      updateTabSession: ({ id, sessionId, title }) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  sessionId,
                  title: title ?? tab.title,
                }
              : tab
          ),
        })),
    }),
    {
      name: "state",
      storage: namespacedStorage("tabs"),
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizeTabsState(persistedState as Partial<PersistedTabsState> | null),
      }),
    }
  )
);
