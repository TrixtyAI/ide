import React, { useEffect, useState } from "react";
import { Settings, Package, Code2 } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { trixty, WebviewView } from "@/api/trixty";
import { useL10n } from "@/hooks/useL10n";
import logoWhite from "@/assets/branding/logo-white.png";

const ActivityBar: React.FC = () => {
  const { activeSidebarTab, setActiveSidebarTab, isSidebarOpen, setSidebarOpen, openFile, setSettingsOpen } = useApp();
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
    // Extensions opens a virtual tab directly, not a sidebar panel
    if (id === "extensions") {
      openFile("virtual://extensions", t('extensions.title'), "", "virtual");
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
    <div className="w-[48px] bg-[#0a0a0a] border-r border-[#1a1a1a] flex flex-col items-center py-2 gap-1 shrink-0">


      {plugins.map((item) => {
        const isActive = activeSidebarTab === item.id && isSidebarOpen;
        return (
          <button
            key={item.id}
            onClick={() => handleTabClick(item.id)}
            className={`w-[40px] h-[40px] flex items-center justify-center rounded-lg transition-all relative group ${isActive ? "text-white bg-white/10" : "text-[#555] hover:text-white/80 hover:bg-white/5"
              }`}
            title={t(item.title)}
          >
            {item.icon}
            {isActive && (
              <div className="absolute left-0 top-[8px] bottom-[8px] w-[2px] bg-white rounded-r-full" />
            )}
            <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-[11px] rounded-md border border-[#2a2a2a] opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity shadow-xl">
              {t(item.title)}
            </div>
          </button>
        );
      })}
      <div className="mt-auto flex flex-col gap-1 items-center">
        {/* Extensions Marketplace (Core Static) */}
        <button
          onClick={() => handleTabClick("extensions")}
          className="w-[40px] h-[40px] flex mb-1 items-center justify-center rounded-lg text-[#555] hover:text-white/80 hover:bg-white/5 transition-all group relative"
        >
          <Package size={20} strokeWidth={1.5} />
          <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-[11px] rounded-md border border-[#2a2a2a] opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity shadow-xl">
            {t('extensions.title')}
          </div>
        </button>

        <button
          onClick={() => handleTabClick("settings")}
          className={`w-[40px] h-[40px] flex items-center justify-center rounded-lg transition-all group relative ${activeSidebarTab === "settings" ? "text-white bg-white/10" : "text-[#555] hover:text-white/80 hover:bg-white/5"
            }`}
        >
          <Settings size={20} strokeWidth={1.5} />
          <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-[11px] rounded-md border border-[#2a2a2a] opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity shadow-xl">
            {t('settings.title')}
          </div>
        </button>
      </div>
    </div>
  );
};

export default ActivityBar;
