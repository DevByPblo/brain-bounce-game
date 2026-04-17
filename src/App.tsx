import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { ScorePopHost } from "@/components/ScorePop";
import Index from "./pages/Index.tsx";
import Multiplayer from "./pages/Multiplayer.tsx";
import Auth from "./pages/Auth.tsx";
import Leaderboard from "./pages/Leaderboard.tsx";
import Collector from "./pages/Collector.tsx";
import NoMove from "./pages/NoMove.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

// Scroll the window to the top whenever the route changes.
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <ScorePopHost />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/multiplayer" element={<Multiplayer />} />
            <Route path="/collector" element={<Collector />} />
            <Route path="/nomove" element={<NoMove />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/auth" element={<Auth />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
