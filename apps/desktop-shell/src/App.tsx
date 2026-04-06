import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppShell } from "@/shell/AppShell";
import { Toaster } from "sonner";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <ThemeProvider>
          <TooltipProvider delayDuration={300}>
            <AppShell />
            <Toaster richColors position="top-right" />
          </TooltipProvider>
        </ThemeProvider>
      </HashRouter>
    </QueryClientProvider>
  );
}
