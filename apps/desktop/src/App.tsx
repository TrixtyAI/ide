import React, { Suspense, lazy } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { AppProviders } from "@/context/AppProviders";
import { ExtensionProvider } from "@/context/ExtensionContext";
import { AgentProvider } from "@/context/AgentContext";
import { ReviewProvider } from "@/context/ReviewContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import HtmlLangSync from "@/components/HtmlLangSync";
import { Toaster } from "sonner";

// Lazy load pages
const HomePage = lazy(() => import("@/app/page"));
const FloatingViewPage = lazy(() => import("@/app/floating/page"));

const App: React.FC = () => {
  return (
    <HashRouter>
      <div className="h-full antialiased font-sans min-h-full flex flex-col bg-background text-white">
        <ErrorBoundary name="Root Layout">
          <AppProviders>
            <AgentProvider>
              <ExtensionProvider>
                <ReviewProvider>
                  <HtmlLangSync />
                  <Toaster richColors position="top-right" theme="dark" />
                  <Routes>
                    <Route 
                      path="/" 
                      element={
                        <Suspense fallback={<div className="bg-surface-0 w-screen h-screen" />}>
                          <HomePage />
                        </Suspense>
                      } 
                    />
                    <Route 
                      path="/floating" 
                      element={
                        <Suspense fallback={<div className="h-screen flex items-center justify-center text-[#666] text-[12px]">…</div>}>
                          <FloatingViewPage />
                        </Suspense>
                      } 
                    />
                  </Routes>
                </ReviewProvider>
              </ExtensionProvider>
            </AgentProvider>
          </AppProviders>
        </ErrorBoundary>
      </div>
    </HashRouter>
  );
};

export default App;
