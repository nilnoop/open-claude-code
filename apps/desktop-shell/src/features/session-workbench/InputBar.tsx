import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { SendHorizonal, Square, Shield, Monitor, Slash } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Slash commands ─────────────────────────────────────────────── */

const SLASH_COMMANDS = [
  { name: "help", desc: "Get help with using Claude Code" },
  { name: "clear", desc: "Clear conversation history" },
  { name: "compact", desc: "Compact conversation to save context" },
  { name: "config", desc: "Open configuration" },
  { name: "cost", desc: "Show token usage and costs" },
  { name: "doctor", desc: "Check system health" },
  { name: "init", desc: "Initialize CLAUDE.md in this project" },
  { name: "login", desc: "Login to your account" },
  { name: "logout", desc: "Logout of your account" },
  { name: "memory", desc: "Edit Claude's memory" },
  { name: "model", desc: "Switch AI model" },
  { name: "permissions", desc: "View and manage permissions" },
  { name: "review", desc: "Review code changes" },
  { name: "status", desc: "Show session status" },
  { name: "terminal-setup", desc: "Set up terminal integration" },
  { name: "vim", desc: "Enter vim mode" },
] as const;

interface InputBarProps {
  onSend: (message: string) => void | Promise<void>;
  onStop?: () => void;
  isBusy?: boolean;
  permissionModeLabel?: string;
  environmentLabel?: string;
}

export function InputBar({
  onSend,
  onStop,
  isBusy = false,
  permissionModeLabel = "Ask permissions",
  environmentLabel = "Local",
}: InputBarProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showCommands, setShowCommands] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);

  // Filter slash commands based on input
  const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().includes(commandFilter.toLowerCase())
  );

  // Detect slash command input
  useEffect(() => {
    if (value.startsWith("/")) {
      const filter = value.slice(1);
      setCommandFilter(filter);
      setShowCommands(true);
      setSelectedCommandIndex(0);
    } else {
      setShowCommands(false);
      setCommandFilter("");
    }
  }, [value]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isBusy) return;
    // Save to history
    setHistory((prev) => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    void onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isBusy, onSend]);

  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  const selectCommand = useCallback(
    (cmdName: string) => {
      const fullCommand = `/${cmdName}`;
      setShowCommands(false);
      setValue("");
      void onSend(fullCommand);
      setHistory((prev) => [fullCommand, ...prev.slice(0, 49)]);
      textareaRef.current?.focus();
    },
    [onSend]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Command palette navigation
    if (showCommands && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCommandIndex((i) =>
          Math.min(i + 1, filteredCommands.length - 1)
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCommandIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectCommand(filteredCommands[selectedCommandIndex].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowCommands(false);
        return;
      }
    }

    // History navigation (only when no command palette)
    if (!showCommands && e.key === "ArrowUp" && !e.shiftKey && value === "") {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setValue(history[newIndex]);
      }
      return;
    }
    if (!showCommands && e.key === "ArrowDown" && !e.shiftKey && historyIndex >= 0) {
      e.preventDefault();
      const newIndex = historyIndex - 1;
      if (newIndex < 0) {
        setHistoryIndex(-1);
        setValue("");
      } else {
        setHistoryIndex(newIndex);
        setValue(history[newIndex]);
      }
      return;
    }

    // Send on Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    // Clear on Escape
    if (e.key === "Escape" && value) {
      e.preventDefault();
      setValue("");
    }
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
  };

  return (
    <div className="relative border-t border-border/50 bg-background px-4 py-3">
      {/* Slash command palette */}
      {showCommands && filteredCommands.length > 0 && (
        <div
          ref={commandListRef}
          className="absolute bottom-full left-4 right-4 mb-1 max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
        >
          <div className="px-2 py-1.5">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Commands
            </div>
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.name}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                  i === selectedCommandIndex
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-accent/50"
                )}
                onClick={() => selectCommand(cmd.name)}
                onMouseEnter={() => setSelectedCommandIndex(i)}
              >
                <Slash className="size-3 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium">{cmd.name}</div>
                  <div className="text-[11px] text-muted-foreground">{cmd.desc}</div>
                </div>
                {i === selectedCommandIndex && (
                  <kbd className="rounded border border-border/50 bg-muted/30 px-1 py-0.5 text-[9px] text-muted-foreground">
                    Enter
                  </kbd>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Textarea */}
      <div
        className={cn(
          "rounded-xl border border-input bg-muted/10 px-4 py-2.5 transition-colors",
          "focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50"
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={
            isBusy
              ? "Waiting for response..."
              : "Type a message... (/ for commands)"
          }
          disabled={isBusy}
          rows={2}
          className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
      </div>

      {/* Bottom button row */}
      <div className="mt-2 flex items-center justify-between">
        {/* Left: permission + environment */}
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 rounded-lg border border-border/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Shield className="size-3" />
            <span>{permissionModeLabel}</span>
          </button>
          <button className="flex items-center gap-1.5 rounded-lg border border-border/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Monitor className="size-3" />
            <span>{environmentLabel}</span>
          </button>
        </div>

        {/* Right: Send or Stop */}
        {isBusy ? (
          <button
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-colors"
            style={{
              backgroundColor: "var(--color-error, rgb(171,43,63))",
            }}
            onClick={handleStop}
          >
            <Square className="size-3" />
            <span>Stop</span>
          </button>
        ) : (
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-colors",
              value.trim()
                ? "cursor-pointer"
                : "cursor-not-allowed opacity-50"
            )}
            style={{ backgroundColor: "var(--claude-orange, rgb(215,119,87))" }}
            onClick={handleSend}
            disabled={!value.trim()}
          >
            <SendHorizonal className="size-3" />
            <span>Send</span>
          </button>
        )}
      </div>
    </div>
  );
}
