import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserApp } from "@/components/BrowserApp";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <BrowserApp />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
