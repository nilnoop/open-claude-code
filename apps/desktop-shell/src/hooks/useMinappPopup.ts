import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { clearWebviewState } from "@/utils/webviewStateManager";
import { findAppById } from "@/config/minapps";
import type { MinAppType } from "@/types/minapp";
import { useMinappsStore } from "@/state/minapps-store";

/**
 * Primary control hook for opening / closing MinApps.
 *
 * In top-tab mode: navigates to `/apps/:id` and adds to keep-alive pool.
 * Mirrors cherry-studio's useMinappPopup.ts
 */
export function useMinappPopup() {
  const navigate = useNavigate();
  const openedKeepAliveApps = useMinappsStore(
    (state) => state.openedKeepAliveApps
  );
  const currentAppId = useMinappsStore((state) => state.currentAppId);
  const addOpenedApp = useMinappsStore((state) => state.addOpenedApp);
  const removeOpenedApp = useMinappsStore((state) => state.removeOpenedApp);
  const setCurrentAppId = useMinappsStore((state) => state.setCurrentAppId);
  const setAppShow = useMinappsStore((state) => state.setAppShow);
  const setOpenedKeepAliveApps = useMinappsStore(
    (state) => state.setOpenedKeepAliveApps
  );

  // Keep a ref to avoid stale closures in closeAllMinapps
  const openedAppsRef = useRef(openedKeepAliveApps);
  openedAppsRef.current = openedKeepAliveApps;

  const openMinappKeepAlive = useCallback(
    (app: MinAppType) => {
      addOpenedApp(app);
      setAppShow(true);
    },
    [addOpenedApp, setAppShow]
  );

  const openMinapp = useCallback(
    (app: MinAppType) => {
      openMinappKeepAlive(app);
      navigate(`/apps/${app.id}`);
    },
    [openMinappKeepAlive, navigate]
  );

  const openSmartMinapp = useCallback(
    (app: MinAppType) => {
      openMinappKeepAlive(app);
      navigate(`/apps/${app.id}`);
    },
    [openMinappKeepAlive, navigate]
  );

  const openMinappById = useCallback(
    (id: string) => {
      const app = findAppById(id);
      if (app) openMinapp(app);
    },
    [openMinapp]
  );

  const closeMinapp = useCallback(
    (appId: string) => {
      removeOpenedApp(appId);
      clearWebviewState(appId);
    },
    [removeOpenedApp]
  );

  const closeAllMinapps = useCallback(() => {
    for (const app of openedAppsRef.current) {
      clearWebviewState(app.id);
    }
    setOpenedKeepAliveApps([]);
    setCurrentAppId("");
    setAppShow(false);
  }, [setAppShow, setCurrentAppId, setOpenedKeepAliveApps]);

  const hideMinappPopup = useCallback(() => {
    setAppShow(false);
  }, [setAppShow]);

  return {
    openMinapp,
    openMinappKeepAlive,
    openSmartMinapp,
    openMinappById,
    closeMinapp,
    closeAllMinapps,
    hideMinappPopup,
    openedKeepAliveApps,
    currentAppId,
  };
}
