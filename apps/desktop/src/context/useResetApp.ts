"use client";

import { useCallback } from "react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useFiles } from "@/context/FilesContext";
import { useChat } from "@/context/ChatContext";
import { useSettings } from "@/context/SettingsContext";
import { useUI } from "@/context/UIContext";
import { trixtyStore } from "@/api/store";

/**
 * Cross-provider reset orchestrator. Previously part of `AppContext.resetApp`
 * when every piece of state lived in one provider. Now it coordinates the
 * individual providers: gates persistence through `setInitialLoadComplete`,
 * wipes the on-disk store, flushes each slice to its defaults, and re-enables
 * persistence after a beat so the fresh defaults aren't clobbered by a
 * mid-flight debounced write from the pre-reset state.
 */
export function useResetApp(): () => Promise<void> {
  const { setRootPath } = useWorkspace();
  const { closeAll } = useFiles();
  const { resetChat } = useChat();
  const { resetSettings, setInitialLoadComplete } = useSettings();
  const { setSettingsOpen } = useUI();

  return useCallback(async () => {
    // 1. Disable persistence during reset to avoid race conditions with
    //    debounced writes flushing the intermediate state back to disk.
    setInitialLoadComplete(false);

    // 2. Clear store from disk
    const keys = [
      "trixty-chats",
      "trixty-ai-settings",
      "trixty-locale",
      "trixty-editor-settings",
      "trixty-system-settings",
      "trixty_ai_last_model",
    ];
    for (const key of keys) {
      await trixtyStore.delete(key);
    }

    // 3. Reset all React state to defaults
    closeAll();
    await setRootPath(null);
    resetChat();
    setSettingsOpen(false);

    // 4. Re-translate default system prompt for the detected locale
    await resetSettings("en");

    // 5. Re-enable to trigger onboarding (hasCompletedOnboarding is now false).
    //    A short delay ensures the state updates above have committed before
    //    persistence effects re-arm.
    setTimeout(() => {
      setInitialLoadComplete(true);
    }, 100);
  }, [
    setInitialLoadComplete,
    closeAll,
    setRootPath,
    resetChat,
    setSettingsOpen,
    resetSettings,
  ]);
}
