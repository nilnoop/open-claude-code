import { useState } from "react";
import {
  Terminal,
  FileEdit,
  Eye,
  Search,
  Globe,
  Shield,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export type PermissionAction = "allow" | "deny" | "allow_always";

export interface PermissionRequest {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  description?: string;
}

interface PermissionDialogProps {
  request: PermissionRequest;
  onDecision: (action: PermissionAction) => void;
}

export function PermissionDialog({ request, onDecision }: PermissionDialogProps) {
  const [showDetails, setShowDetails] = useState(false);
  const { icon: ToolIcon, label, color } = getPermToolMeta(request.toolName);

  const riskConfig = {
    low: {
      borderColor: "var(--color-success, rgb(44,122,57))",
      bgColor: "color-mix(in srgb, var(--color-success, rgb(44,122,57)) 5%, transparent)",
      label: "Low risk",
      icon: ShieldCheck,
    },
    medium: {
      borderColor: "var(--color-warning, rgb(150,108,30))",
      bgColor: "color-mix(in srgb, var(--color-warning, rgb(150,108,30)) 5%, transparent)",
      label: "Medium risk",
      icon: Shield,
    },
    high: {
      borderColor: "var(--color-error, rgb(171,43,63))",
      bgColor: "color-mix(in srgb, var(--color-error, rgb(171,43,63)) 5%, transparent)",
      label: "High risk",
      icon: AlertTriangle,
    },
  };

  const risk = riskConfig[request.riskLevel];
  const RiskIcon = risk.icon;

  // Format preview of what the tool wants to do
  const actionPreview = formatActionPreview(request.toolName, request.toolInput);

  return (
    <div className="mx-4 my-2">
      <div
        className="overflow-hidden rounded-lg border"
        style={{
          borderColor: risk.borderColor,
          backgroundColor: risk.bgColor,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2.5">
          <div
            className="flex size-6 items-center justify-center rounded-md"
            style={{
              backgroundColor: "var(--color-permission, rgb(87,105,247))",
            }}
          >
            <Shield className="size-3.5 text-white" />
          </div>
          <span className="text-[13px] font-semibold text-foreground">
            Permission Required
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <RiskIcon className="size-3" style={{ color: risk.borderColor }} />
            <span className="text-[10px] font-medium" style={{ color: risk.borderColor }}>
              {risk.label}
            </span>
          </div>
        </div>

        {/* Tool action summary */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 text-[13px]">
            <ToolIcon className="size-4 shrink-0" style={{ color }} />
            <span className="font-medium" style={{ color }}>{label}</span>
            <span className="text-muted-foreground">wants to:</span>
          </div>

          {/* Action preview */}
          <div className="mt-2 rounded-md bg-muted/30 px-3 py-2">
            <pre className="whitespace-pre-wrap font-mono text-[12px] text-foreground/90">
              {actionPreview}
            </pre>
          </div>

          {/* Details toggle */}
          <button
            className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <span>Full details</span>
          </button>
          {showDetails && (
            <div className="mt-1 rounded-md bg-muted/20 p-2">
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                {JSON.stringify(request.toolInput, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 border-t border-border/30 px-4 py-2.5">
          <button
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-white transition-colors"
            style={{ backgroundColor: "var(--color-permission, rgb(87,105,247))" }}
            onClick={() => onDecision("allow")}
          >
            <ShieldCheck className="size-3" />
            Allow once
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/40"
            onClick={() => onDecision("allow_always")}
          >
            <ShieldCheck className="size-3" />
            Always allow
          </button>
          <div className="flex-1" />
          <button
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors"
            style={{ color: "var(--color-error, rgb(171,43,63))" }}
            onClick={() => onDecision("deny")}
          >
            <ShieldX className="size-3" />
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Format action preview ──────────────────────────────────────── */

function formatActionPreview(
  toolName: string,
  input: Record<string, unknown>
): string {
  const lower = toolName.toLowerCase();

  if (lower === "bash" || lower.includes("shell")) {
    return `$ ${String(input.command ?? input.cmd ?? "")}`;
  }
  if (lower === "read" || lower === "readfile") {
    return `Read file: ${String(input.file_path ?? input.path ?? "")}`;
  }
  if (lower === "edit" || lower === "editfile") {
    return `Edit file: ${String(input.file_path ?? input.path ?? "")}`;
  }
  if (lower === "write" || lower === "writefile") {
    return `Write file: ${String(input.file_path ?? input.path ?? "")}`;
  }
  if (lower === "glob") {
    return `Search files: ${String(input.pattern ?? "")}`;
  }
  if (lower === "grep") {
    return `Search content: ${String(input.pattern ?? "")}`;
  }
  if (lower.includes("webfetch") || lower.includes("web_fetch")) {
    return `Fetch URL: ${String(input.url ?? "")}`;
  }

  // Fallback: show first key-value
  const entries = Object.entries(input);
  if (entries.length > 0) {
    return entries.map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join("\n");
  }
  return toolName;
}

/* ─── Tool metadata for permissions ──────────────────────────────── */

function getPermToolMeta(toolName: string) {
  const lower = toolName.toLowerCase();

  if (lower === "bash" || lower.includes("shell"))
    return { icon: Terminal, label: "Bash", color: "var(--color-terminal-tool, rgb(44,122,57))" };
  if (lower === "read" || lower === "readfile")
    return { icon: Eye, label: "Read", color: "var(--claude-blue, rgb(87,105,247))" };
  if (lower === "edit" || lower === "editfile" || lower === "write" || lower === "writefile")
    return { icon: FileEdit, label: toolName, color: "var(--claude-orange, rgb(215,119,87))" };
  if (lower === "glob" || lower === "grep")
    return { icon: Search, label: toolName, color: "var(--color-terminal-tool, rgb(44,122,57))" };
  if (lower.includes("web"))
    return { icon: Globe, label: toolName, color: "var(--claude-blue, rgb(87,105,247))" };

  return { icon: Terminal, label: toolName, color: "var(--color-terminal-tool, rgb(44,122,57))" };
}
