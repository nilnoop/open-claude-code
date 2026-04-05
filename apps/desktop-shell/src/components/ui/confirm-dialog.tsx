import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
}: ConfirmDialogProps) {
  const isDestructive = variant === "destructive";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-5 shadow-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
          <div className="flex items-start gap-3">
            {isDestructive && (
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--color-error) 10%, transparent)",
                }}
              >
                <AlertTriangle className="size-4" style={{ color: "var(--color-error)" }} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[14px] font-semibold text-foreground">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button variant="outline" size="sm" className="text-[12px]">
                {cancelLabel}
              </Button>
            </DialogPrimitive.Close>
            <Button
              variant={isDestructive ? "destructive" : "default"}
              size="sm"
              className="text-[12px]"
              style={
                isDestructive
                  ? { backgroundColor: "var(--color-error)", color: "white" }
                  : undefined
              }
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
