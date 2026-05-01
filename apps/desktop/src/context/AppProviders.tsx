"use client";

import React from "react";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { FilesProvider } from "@/context/FilesContext";
import { ChatProvider } from "@/context/ChatContext";
import { UIProvider } from "@/context/UIContext";
import { CollaborationProvider } from "@/context/CollaborationContext";
import { useDiscordRPC } from "@/hooks/useDiscordRPC";
import { useWorkspaceSync } from "@/hooks/useWorkspaceSync";

export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <SettingsProvider>
    <CollaborationProvider>
      <WorkspaceProvider>
        <ChatProvider>
          <UIProvider>
            <FilesProvider>
              <AppLifecycleWrapper>
                {children}
              </AppLifecycleWrapper>
            </FilesProvider>
          </UIProvider>
        </ChatProvider>
      </WorkspaceProvider>
    </CollaborationProvider>
  </SettingsProvider>
);

const AppLifecycleWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useDiscordRPC();
  useWorkspaceSync();
  return <>{children}</>;
};
