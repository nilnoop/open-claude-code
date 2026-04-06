import { SettingGroup } from "../components/SettingGroup";
import { cn } from "@/lib/utils";
import { PERMISSION_MODES } from "@/features/session-workbench/InputBar";
import type { DesktopCustomizeState } from "@/lib/tauri";
import { useSettingsStore } from "@/state/settings-store";

interface PermissionSettingsProps {
  customize: DesktopCustomizeState | null;
  error?: string;
}

export function PermissionSettings({
  customize,
  error,
}: PermissionSettingsProps) {
  const currentMode = useSettingsStore((state) => state.permissionMode);
  const setPermissionMode = useSettingsStore((state) => state.setPermissionMode);

  return (
    <div className="space-y-4">
      <SettingGroup
        title="Permission Mode"
        description="Controls how tool execution permissions are handled"
      >
        <div className="space-y-2">
          {PERMISSION_MODES.map((mode) => {
            const Icon = mode.icon;
            const isActive = currentMode === mode.value;
            return (
              <button
                key={mode.value}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors",
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/30"
                )}
                onClick={() => setPermissionMode(mode.value)}
              >
                <Icon
                  className="size-5 shrink-0"
                  style={mode.color ? { color: mode.color } : undefined}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">{mode.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {mode.desc}
                  </div>
                </div>
                {isActive && (
                  <div className="size-2 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
        {customize?.permission_mode && (
          <div className="text-xs text-muted-foreground">
            Runtime value: {customize.permission_mode}
          </div>
        )}
      </SettingGroup>

      {error && (
        <SettingGroup title="Warnings">
          <div className="text-xs text-muted-foreground">{error}</div>
        </SettingGroup>
      )}
    </div>
  );
}
