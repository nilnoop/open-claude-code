import { HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AnthropicProviderListPopoverProps {
  providerNames: string[];
}

export function AnthropicProviderListPopover({
  providerNames,
}: AnthropicProviderListPopoverProps) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle
          size={14}
          className="cursor-pointer text-muted-foreground"
        />
      </TooltipTrigger>
      <TooltipContent side="right" className="w-[220px] p-3">
        <div className="mb-2 text-[12px] font-medium">{t("provider.popover.supported")}</div>
        <div className="flex flex-col gap-1.5">
          {providerNames.length > 0 ? (
            providerNames.map((name) => (
              <div key={name} className="text-[12px] text-foreground">
                {name}
              </div>
            ))
          ) : (
            <div className="text-[12px] text-muted-foreground">
              {t("provider.popover.noAnthropicProviders")}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
