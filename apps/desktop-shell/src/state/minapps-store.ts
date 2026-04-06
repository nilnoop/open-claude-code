import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BUILTIN_APPS } from "@/config/minapps";
import type { MinAppType } from "@/types/minapp";
import { namespacedStorage, readLegacyPersistedSlice } from "./store-helpers";

export interface MinappsState {
  enabled: MinAppType[];
  disabled: MinAppType[];
  pinned: MinAppType[];
  openedKeepAliveApps: MinAppType[];
  currentAppId: string;
  appShow: boolean;
  setEnabledApps: (apps: MinAppType[]) => void;
  setDisabledApps: (apps: MinAppType[]) => void;
  setPinnedApps: (apps: MinAppType[]) => void;
  setOpenedKeepAliveApps: (apps: MinAppType[]) => void;
  setCurrentAppId: (appId: string) => void;
  setAppShow: (show: boolean) => void;
  addOpenedApp: (app: MinAppType) => void;
  removeOpenedApp: (appId: string) => void;
}

type PersistedMinappsState = Pick<
  MinappsState,
  | "enabled"
  | "disabled"
  | "pinned"
  | "openedKeepAliveApps"
  | "currentAppId"
  | "appShow"
>;

const defaultMinappsState: PersistedMinappsState = {
  enabled: [...BUILTIN_APPS],
  disabled: [],
  pinned: [],
  openedKeepAliveApps: [],
  currentAppId: "",
  appShow: false,
};

function ensureMinapps(apps: unknown, fallback: MinAppType[]) {
  return Array.isArray(apps)
    ? apps.filter((app): app is MinAppType => Boolean(app && typeof app === "object"))
    : fallback;
}

function normalizeMinappsState(
  persisted?: Partial<PersistedMinappsState> | null
): PersistedMinappsState {
  if (!persisted) {
    return defaultMinappsState;
  }

  return {
    enabled: ensureMinapps(persisted.enabled, defaultMinappsState.enabled),
    disabled: ensureMinapps(persisted.disabled, defaultMinappsState.disabled),
    pinned: ensureMinapps(persisted.pinned, defaultMinappsState.pinned),
    openedKeepAliveApps: ensureMinapps(
      persisted.openedKeepAliveApps,
      defaultMinappsState.openedKeepAliveApps
    ),
    currentAppId:
      typeof persisted.currentAppId === "string"
        ? persisted.currentAppId
        : defaultMinappsState.currentAppId,
    appShow:
      typeof persisted.appShow === "boolean"
        ? persisted.appShow
        : defaultMinappsState.appShow,
  };
}

function createInitialMinappsState() {
  return normalizeMinappsState(
    readLegacyPersistedSlice<Partial<PersistedMinappsState>>("minapps")
  );
}

export const useMinappsStore = create<MinappsState>()(
  persist(
    (set) => ({
      ...createInitialMinappsState(),
      setEnabledApps: (enabled) => set({ enabled }),
      setDisabledApps: (disabled) => set({ disabled }),
      setPinnedApps: (pinned) => set({ pinned }),
      setOpenedKeepAliveApps: (openedKeepAliveApps) => set({ openedKeepAliveApps }),
      setCurrentAppId: (currentAppId) => set({ currentAppId }),
      setAppShow: (appShow) => set({ appShow }),
      addOpenedApp: (app) =>
        set((state) => ({
          openedKeepAliveApps: state.openedKeepAliveApps.some(
            (openedApp) => openedApp.id === app.id
          )
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
    }),
    {
      name: "state",
      storage: namespacedStorage("minapps"),
      partialize: (state) => ({
        enabled: state.enabled,
        disabled: state.disabled,
        pinned: state.pinned,
        openedKeepAliveApps: state.openedKeepAliveApps,
        currentAppId: state.currentAppId,
        appShow: state.appShow,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...normalizeMinappsState(
          persistedState as Partial<PersistedMinappsState> | null
        ),
      }),
    }
  )
);
