import type { MinAppType } from "@/types/minapp";
import { useMinappsStore } from "@/state/minapps-store";

/**
 * Hook for reading and managing the MinApp catalog.
 * Mirrors cherry-studio's useMinapps.ts
 */
export function useMinapps() {
  const minapps = useMinappsStore((state) => state.enabled);
  const disabled = useMinappsStore((state) => state.disabled);
  const pinned = useMinappsStore((state) => state.pinned);
  const setEnabledApps = useMinappsStore((state) => state.setEnabledApps);
  const setDisabledApps = useMinappsStore((state) => state.setDisabledApps);
  const setPinnedApps = useMinappsStore((state) => state.setPinnedApps);

  const updateMinapps = (apps: MinAppType[]) => {
    setEnabledApps(apps);
  };

  const updateDisabledMinapps = (apps: MinAppType[]) => {
    setDisabledApps(apps);
  };

  const updatePinnedMinapps = (apps: MinAppType[]) => {
    setPinnedApps(apps);
  };

  return {
    minapps,
    disabled,
    pinned,
    updateMinapps,
    updateDisabledMinapps,
    updatePinnedMinapps,
  };
}
