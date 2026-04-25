"use client";

import React from "react";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { FilesProvider } from "@/context/FilesContext";
import { ChatProvider } from "@/context/ChatContext";
import { UIProvider } from "@/context/UIContext";

/**
 * Composes the narrow providers that together own what used to live in
 * `AppContext`. The nesting order is intentional but not load-bearing for
 * React-semantic reasons — none of the providers call hooks from another.
 * It is chosen so the hottest, most frequently re-rendered provider
 * (`FilesProvider` — keystroke-scale updates through `updateFileContent`)
 * sits below the session-scoped ones, keeping the slower providers off the
 * keystroke render path entirely.
 */
export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <WorkspaceProvider>
    <SettingsProvider>
      <ChatProvider>
        <UIProvider>
          <FilesProvider>
            {children}
          </FilesProvider>
        </UIProvider>
      </ChatProvider>
    </SettingsProvider>
  </WorkspaceProvider>
);
