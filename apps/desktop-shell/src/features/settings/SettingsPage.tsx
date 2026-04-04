import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Settings,
  Key,
  Plug,
  Shield,
  Keyboard,
  Database,
  Info,
  Loader2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { GeneralSettings } from "./sections/GeneralSettings";
import { ProviderSettings } from "./sections/ProviderSettings";
import { McpSettings } from "./sections/McpSettings";
import { PermissionSettings } from "./sections/PermissionSettings";
import { DataSettings } from "./sections/DataSettings";
import { AboutSection } from "./sections/AboutSection";
import {
  getBootstrap,
  getCustomize,
  getSettings,
  type DesktopBootstrap,
  type DesktopCustomizeState,
  type DesktopSettingsState,
} from "@/lib/tauri";

type SettingsSection =
  | "general"
  | "provider"
  | "mcp"
  | "permissions"
  | "shortcuts"
  | "data"
  | "about";

interface MenuItem {
  id: SettingsSection;
  label: string;
  icon: typeof Settings;
}

const MENU_ITEMS: MenuItem[] = [
  { id: "general", label: "常规", icon: Settings },
  { id: "provider", label: "模型服务", icon: Key },
  { id: "mcp", label: "MCP 服务", icon: Plug },
  { id: "permissions", label: "权限", icon: Shield },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "data", label: "数据", icon: Database },
  { id: "about", label: "关于", icon: Info },
];

export function SettingsPage() {
  const [active, setActive] = useState<SettingsSection>("general");

  const bootstrapQuery = useQuery({
    queryKey: ["desktop-bootstrap"],
    queryFn: getBootstrap,
  });

  const settingsQuery = useQuery({
    queryKey: ["desktop-settings"],
    queryFn: getSettings,
  });

  const customizeQuery = useQuery({
    queryKey: ["desktop-customize"],
    queryFn: getCustomize,
  });

  // Treat error states as "loaded with null data" — pages have fallback values
  const isLoading =
    (bootstrapQuery.isLoading && !bootstrapQuery.isError) ||
    (settingsQuery.isLoading && !settingsQuery.isError) ||
    (customizeQuery.isLoading && !customizeQuery.isError);
  const error = extractErrorMessage(
    bootstrapQuery.error,
    settingsQuery.error,
    customizeQuery.error
  );

  return (
    <div className="flex h-full">
      <div className="flex w-[200px] shrink-0 flex-col border-r border-border bg-sidebar-background">
        <div className="px-3 py-2.5">
          <h2 className="text-[13px] font-semibold text-foreground">设置</h2>
        </div>
        <Separator />
        <nav className="flex-1 px-1.5 py-1.5">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] transition-colors",
                active === item.id
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
              onClick={() => setActive(item.id)}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <ScrollArea className="flex-1">
        <div
          className={cn(
            "px-6 py-4",
            active === "provider" ? "max-w-none px-5" : "mx-auto max-w-3xl"
          )}
        >
          <h2 className="mb-3 text-[15px] font-semibold text-foreground">
            {MENU_ITEMS.find((m) => m.id === active)?.label}
          </h2>

          <SettingsContent
            section={active}
            isLoading={isLoading}
            bootstrap={bootstrapQuery.data}
            settings={settingsQuery.data?.settings ?? null}
            customize={customizeQuery.data?.customize ?? null}
            error={error}
          />
        </div>
      </ScrollArea>
    </div>
  );
}

/** Loading placeholder for sections that depend on backend data */
function SectionLoading() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span>正在加载桌面设置...</span>
    </div>
  );
}

function SettingsContent({
  section,
  isLoading,
  bootstrap,
  settings,
  customize,
  error,
}: {
  section: SettingsSection;
  isLoading: boolean;
  bootstrap: DesktopBootstrap | undefined;
  settings: DesktopSettingsState | null;
  customize: DesktopCustomizeState | null;
  error?: string;
}) {
  // GeneralSettings uses Redux — no backend needed
  if (section === "general") return <GeneralSettings />;

  // Other sections need backend data
  if (isLoading) return <SectionLoading />;

  switch (section) {
    case "provider":
      return (
        <ProviderSettings
          customize={customize}
          error={error}
        />
      );
    case "mcp":
      return <McpSettings customize={customize} error={error} />;
    case "permissions":
      return <PermissionSettings customize={customize} error={error} />;
    case "data":
      return <DataSettings settings={settings} error={error} />;
    case "about":
      return (
        <AboutSection
          productName={bootstrap?.product_name}
          error={error}
          settings={settings}
        />
      );
    default:
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          即将支持
        </div>
      );
  }
}

function extractErrorMessage(...errors: Array<unknown>): string | undefined {
  for (const error of errors) {
    if (error instanceof Error) {
      return error.message;
    }
  }
  return undefined;
}
