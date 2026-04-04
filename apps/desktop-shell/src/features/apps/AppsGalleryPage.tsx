import { useState } from "react";
import { Search, Brain, Plug, Globe, FileCode } from "lucide-react";
import { MinAppIcon } from "@/components/MinApp/MinAppIcon";
import { useMinapps } from "@/hooks/useMinapps";
import { useMinappPopup } from "@/hooks/useMinappPopup";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MinAppType } from "@/types/minapp";

/**
 * Apps gallery page rendered at `/apps`.
 *
 * Hybrid layout: original MinApp grid (cherry-studio icons) + Claude Code style tool cards.
 */
export function AppsGalleryPage() {
  const { minapps } = useMinapps();
  const [search, setSearch] = useState("");

  const filteredApps = search
    ? minapps.filter(
        (app) =>
          app.name.toLowerCase().includes(search.toLowerCase()) ||
          app.url.toLowerCase().includes(search.toLowerCase())
      )
    : minapps;

  const TOOL_CARDS = [
    {
      id: "mcp-inspector",
      label: "MCP Inspector",
      desc: "Debug MCP server connections and tools",
      icon: Plug,
      gradient: "linear-gradient(135deg, var(--claude-blue, #5769F7), #7C8BFF)",
    },
    {
      id: "web-browser",
      label: "Web Browser",
      desc: "Browse and fetch web pages",
      icon: Globe,
      gradient: "linear-gradient(135deg, var(--agent-cyan, #0891B2), #06B6D4)",
    },
    {
      id: "code-review",
      label: "Code Review",
      desc: "Review diffs and pull requests",
      icon: FileCode,
      gradient: "linear-gradient(135deg, var(--color-success, #2C7A39), #4EBA65)",
    },
    {
      id: "agent-lab",
      label: "Agent Lab",
      desc: "Multi-agent workflow experiments",
      icon: Brain,
      gradient: "linear-gradient(135deg, var(--agent-purple, #9333EA), #A855F7)",
    },
  ];

  const filteredTools = search
    ? TOOL_CARDS.filter((t) => t.label.toLowerCase().includes(search.toLowerCase()))
    : TOOL_CARDS;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Search */}
      <div className="flex items-center justify-center px-4 py-3">
        <div className="flex w-full max-w-md items-center gap-2 rounded-lg border border-border/50 bg-muted/10 px-3 py-1.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            placeholder="Search apps..."
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-5 pb-8">
          {/* Core apps (MinApp icons) */}
          <section className="mb-6">
            <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Core
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {filteredApps.map((app) => (
                <MinAppCard key={app.id} app={app} />
              ))}
            </div>
          </section>

          {/* Tool cards */}
          {filteredTools.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tools
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {filteredTools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <button
                      key={tool.id}
                      className="flex items-start gap-3 rounded-xl border border-border/40 bg-background p-3 text-left transition-all hover:border-foreground/15 hover:bg-muted/10 hover:shadow-sm active:scale-[0.98]"
                    >
                      <div
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                        style={{ background: tool.gradient }}
                      >
                        <Icon className="size-4 text-white" />
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="text-[12px] font-semibold text-foreground">{tool.label}</div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {tool.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Card-style MinApp item — matches the Tools card layout */
function MinAppCard({ app }: { app: MinAppType }) {
  const { openSmartMinapp } = useMinappPopup();

  return (
    <button
      className="flex items-start gap-3 rounded-xl border border-border/40 bg-background p-3 text-left transition-all hover:border-foreground/15 hover:bg-muted/10 hover:shadow-sm active:scale-[0.98]"
      onClick={() => openSmartMinapp(app)}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg overflow-hidden">
        <MinAppIcon app={app} size={36} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-[12px] font-semibold text-foreground">{app.name}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {app.url ? new URL(app.url).hostname : "Built-in app"}
        </div>
      </div>
    </button>
  );
}
