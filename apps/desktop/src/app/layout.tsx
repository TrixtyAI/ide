import "./globals.css";

import { AppProviders } from "@/context/AppProviders";
import { ExtensionProvider } from "@/context/ExtensionContext";
import { AgentProvider } from "@/context/AgentContext";
import { ReviewProvider } from "@/context/ReviewContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import HtmlLangSync from "@/components/HtmlLangSync";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="font-sans min-h-full flex flex-col bg-background text-white">
        <ErrorBoundary name="Root Layout">
          <AppProviders>
            <AgentProvider>
              <ExtensionProvider>
                <ReviewProvider>
                  <HtmlLangSync />
                  {children}
                </ReviewProvider>
              </ExtensionProvider>
            </AgentProvider>
          </AppProviders>
        </ErrorBoundary>
      </body>
    </html>
  );
}
