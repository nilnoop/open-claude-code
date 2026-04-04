import { Badge } from "@/components/ui/badge";

interface ContentHeaderProps {
  title?: string;
  projectPath?: string;
  modelLabel?: string;
  environmentLabel?: string;
  isStreaming?: boolean;
}

export function ContentHeader({
  title = "Warwolf",
  projectPath,
  modelLabel = "Opus 4.6",
  environmentLabel = "Local",
  isStreaming = false,
}: ContentHeaderProps) {
  return (
    <div className="flex items-start justify-between px-4 pb-1.5 pt-2.5">
      {/* Left: title + project path */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-[13px] font-semibold text-foreground">{title}</h1>
          {isStreaming && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--claude-orange, rgb(215,119,87))" }}>
              <span
                className="inline-block size-1.5 animate-pulse rounded-full"
                style={{ backgroundColor: "var(--claude-orange, rgb(215,119,87))" }}
              />
              Streaming
            </span>
          )}
        </div>
        {projectPath && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {projectPath}
          </p>
        )}
      </div>

      {/* Right: badges */}
      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        <Badge
          variant="secondary"
          className="h-[18px] rounded-md px-1.5 text-[10px] font-medium"
        >
          {modelLabel}
        </Badge>
        <Badge
          variant="outline"
          className="h-[18px] rounded-md px-1.5 text-[10px] font-medium"
        >
          {environmentLabel}
        </Badge>
      </div>
    </div>
  );
}
