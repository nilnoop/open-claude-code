import { useState } from "react";
import {
  Loader2,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Clock,
  Zap,
} from "lucide-react";
import { useAppDispatch } from "@/store";
import { setShowSessionSidebar } from "@/store/slices/settings";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { truncate, cn } from "@/lib/utils";
import type { DesktopSessionSection } from "@/lib/tauri";

interface SessionWorkbenchSidebarProps {
  sessionSections: DesktopSessionSection[];
  activeSessionId?: string | null;
  projectLabel: string;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  isCreatingSession: boolean;
}

export function SessionWorkbenchSidebar({
  sessionSections,
  activeSessionId,
  projectLabel,
  onSelectSession,
  onCreateSession,
  isCreatingSession,
}: SessionWorkbenchSidebarProps) {
  const dispatch = useAppDispatch();
  const [searchQuery, setSearchQuery] = useState("");

  // Filter sessions by search query
  const filteredSections = sessionSections
    .map((section) => ({
      ...section,
      sessions: section.sessions.filter((s) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          s.title.toLowerCase().includes(q) ||
          s.preview.toLowerCase().includes(q)
        );
      }),
    }))
    .filter((section) => section.sessions.length > 0);

  const totalSessions = sessionSections.reduce(
    (sum, s) => sum + s.sessions.length,
    0
  );

  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-sidebar-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[12px] font-medium text-sidebar-foreground">
          Sessions
          {totalSessions > 0 && (
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              ({totalSessions})
            </span>
          )}
        </span>
        <div className="flex gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={onCreateSession}
                disabled={isCreatingSession}
              >
                {isCreatingSession ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Session</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => dispatch(setShowSessionSidebar(false))}
              >
                <PanelLeftClose className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hide Sidebar</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Search */}
      {totalSessions > 3 && (
        <div className="px-2 pb-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/10 px-2 py-1">
            <Search className="size-3 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="w-full bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      )}

      {/* Session list */}
      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-2">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {projectLabel}
          </div>

          {filteredSections.map((section) => (
            <div key={section.id} className="mb-2">
              <div className="flex items-center gap-1.5 px-2 py-1">
                <Clock className="size-2.5 text-muted-foreground/50" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.label}
                </span>
              </div>
              <div className="space-y-0.5">
                {section.sessions.map((session) => (
                  <button
                    key={session.id}
                    className={cn(
                      "group w-full rounded-md px-2 py-1.5 text-left transition-colors",
                      session.id === activeSessionId
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <MessageSquare className="size-3 shrink-0 opacity-40" />
                      <span className="flex-1 truncate text-[12px] font-medium">
                        {truncate(session.title, 28)}
                      </span>
                      {session.turn_state === "running" && (
                        <span className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px]"
                          style={{
                            backgroundColor: "color-mix(in srgb, var(--claude-orange, rgb(215,119,87)) 15%, transparent)",
                            color: "var(--claude-orange, rgb(215,119,87))",
                          }}
                        >
                          <Zap className="size-2" />
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 pl-[18px] text-[10px] text-muted-foreground">
                      <div className="truncate">{truncate(session.preview, 40)}</div>
                      <div className="mt-0.5 flex items-center gap-1 opacity-60">
                        <span>{session.model_label}</span>
                        <span>·</span>
                        <span>{session.environment_label}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {filteredSections.length === 0 && searchQuery && (
            <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              No sessions match "{searchQuery}"
            </div>
          )}

          {totalSessions === 0 && (
            <div className="px-2 py-8 text-center text-[11px] text-muted-foreground">
              No sessions yet.
              <br />
              Start a conversation to create one.
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Bottom: new session button */}
      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          className="h-7 w-full justify-start gap-2 text-[11px]"
          onClick={onCreateSession}
          disabled={isCreatingSession}
        >
          {isCreatingSession ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Plus className="size-3" />
          )}
          New Session
        </Button>
      </div>
    </div>
  );
}
