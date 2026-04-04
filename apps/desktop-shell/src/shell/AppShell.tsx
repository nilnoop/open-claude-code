import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { TabBar } from "./TabBar";
import { HomePage } from "@/features/workbench/HomePage";
import { AppsGalleryPage } from "@/features/apps/AppsGalleryPage";
import { MinAppDetailPage } from "@/features/apps/MinAppDetailPage";

/** Lightweight fade-in wrapper keyed by pathname */
function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="h-full animate-fade-in">
      {children}
    </div>
  );
}

/**
 * Root application shell.
 *
 * Uses React Router for content routing while the TabBar provides
 * the cherry-studio-style top tab navigation.
 *
 * Route structure:
 *   /home      -> HomePage (workbench with sessions, search, settings, etc.)
 *   /apps      -> AppsGalleryPage (cherry-studio grid of MinApps)
 *   /apps/:id  -> MinAppDetailPage (toolbar + keep-alive content pool)
 */
export function AppShell() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TabBar />
      <main className="relative flex-1 overflow-hidden">
        <Routes>
          <Route path="/home" element={<PageTransition><HomePage /></PageTransition>} />
          <Route path="/apps" element={<PageTransition><AppsGalleryPage /></PageTransition>} />
          <Route path="/apps/:appId" element={<PageTransition><MinAppDetailPage /></PageTransition>} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
    </div>
  );
}
