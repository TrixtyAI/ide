import "./globals.css";

import { AppProvider } from "@/context/AppContext";
import { ExtensionProvider } from "@/context/ExtensionContext";
import { AgentProvider } from "@/context/AgentContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="font-sans min-h-full flex flex-col bg-[#1e1e1e] text-white">
        <ErrorBoundary name="Root Layout">
          <AppProvider>
            <AgentProvider>
              <ExtensionProvider>
                {children}
              </ExtensionProvider>
            </AgentProvider>
          </AppProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
