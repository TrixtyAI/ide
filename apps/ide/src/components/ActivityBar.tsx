import React, { useEffect, useState } from "react";
import { Settings, Package, Globe } from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useFiles } from "@/context/FilesContext";
import { trixty, WebviewView } from "@/api/trixty";
import { useL10n } from "@/hooks/useL10n";
import Tooltip from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import * as Sentry from "@sentry/nextjs";

const ActivityBar: React.FC = () => {
  const { activeSidebarTab, setActiveSidebarTab, isSidebarOpen, setSidebarOpen, setSettingsOpen } = useUI();
  const { openFile } = useFiles();
  const [plugins, setPlugins] = useState<WebviewView[]>([]);
  const { t } = useL10n();

  useEffect(() => {
    const update = () => {
      setPlugins(trixty.window.getLeftPanelViews());
      // If we don't have an active tab yet, select the first plugin by default
      const views = trixty.window.getLeftPanelViews();
      if (views.length > 0 && !activeSidebarTab) {
        setActiveSidebarTab(views[0].id);
      }
    };
    update();
    return trixty.window.subscribe(update);
  }, [activeSidebarTab, setActiveSidebarTab]);

  const handleTabClick = (id: string) => {
    // Track navigation metric
    Sentry.metrics.count('navigation_sidebar_click', 1, {
      attributes: { tab_id: id }
    });

    // Extensions opens a virtual tab directly, not a sidebar panel
    if (id === "extensions") {
      openFile("virtual://extensions", t('extensions.title'), "", "virtual");
      return;
    }

    if (id === "browser") {
      openFile("virtual://browser", t('browser.title'), "", "virtual");
      return;
    }

    if (id === "settings") {
      setSettingsOpen(true);
      return;
    }

    if (activeSidebarTab === id && isSidebarOpen) {
      setSidebarOpen(false);
    } else {
      setActiveSidebarTab(id);
      setSidebarOpen(true);
    }
  };

  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={t('activitybar.label')}
      className="w-[48px] bg-surface-0 border-r border-border-subtle flex flex-col items-center py-2 gap-1 shrink-0"
    >


      {plugins.map((item) => {
        const isActive = activeSidebarTab === item.id && isSidebarOpen;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={isActive}
            aria-label={t(item.title)}
            onClick={() => handleTabClick(item.id)}
            className={cn(
              "w-[40px] h-[40px] flex items-center justify-center rounded-lg transition-all relative group focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              isActive
                ? "text-white bg-white/10"
                : "text-subtle-fg hover:text-white/80 hover:bg-white/5",
            )}
            title={t(item.title)}
          >
            {item.icon}
            {isActive && (
              <div aria-hidden="true" className="absolute left-0 top-[8px] bottom-[8px] w-[2px] bg-white rounded-r-full" />
            )}
            <Tooltip label={t(item.title)} />
          </button>
        );
      })}
      <div className="mt-auto flex flex-col gap-1 items-center">
        <button
          role="tab"
          aria-selected={false}
          aria-label={t('browser.title')}
          onClick={() => handleTabClick("browser")}
          className="w-[40px] h-[40px] flex items-center justify-center rounded-lg text-subtle-fg hover:text-white/80 hover:bg-white/5 transition-all group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={t('browser.title')}
        >
          <Globe size={18} strokeWidth={1.5} />
          <Tooltip label={t('browser.title')} />
        </button>

        <button
          role="tab"
          aria-selected={false}
          aria-label={t('extensions.title')}
          onClick={() => handleTabClick("extensions")}
          className="w-[40px] h-[40px] flex mb-1 items-center justify-center rounded-lg text-subtle-fg hover:text-white/80 hover:bg-white/5 transition-all group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title={t('extensions.title')}
        >
          <Package size={18} strokeWidth={1.5} />
          <Tooltip label={t('extensions.title')} />
        </button>

        <button
          role="tab"
          aria-selected={activeSidebarTab === "settings"}
          aria-label={t('settings.title')}
          onClick={() => handleTabClick("settings")}
          className={cn(
            "w-[40px] h-[40px] flex items-center justify-center rounded-lg transition-all group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
            activeSidebarTab === "settings"
              ? "text-white bg-white/10"
              : "text-subtle-fg hover:text-white/80 hover:bg-white/5",
          )}
          title={t('settings.title')}
        >
          <Settings size={18} strokeWidth={1.5} />
          <Tooltip label={t('settings.title')} />
        </button>
      </div>
    </div>
  );
};

export default ActivityBar;
