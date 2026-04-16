"use client";
import React, { useEffect, useState } from "react";
import { trixty, WebviewView } from "@/api/trixty";
import { ChevronRight } from "lucide-react";
import { useL10n } from "@/hooks/useL10n";

export default function RightPanelSlot() {
    const [views, setViews] = useState<WebviewView[]>([]);
    const { t } = useL10n();

    const [collapsedViews, setCollapsedViews] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const update = () => setViews(trixty.window.getRightPanelViews());
        update();
        return trixty.window.subscribe(update);
    }, []);

    const toggleView = (id: string) => {
        setCollapsedViews(prev => ({ ...prev, [id]: !prev[id] }));
    };

    if (views.length === 0) {
        return <div className="flex-1 flex items-center justify-center text-[#666] text-xs h-full bg-[#0e0e0e]">{t('panel.right.no_addons')}</div>;
    }

    return (
        <div className="flex flex-col h-full w-full bg-[#0e0e0e] divide-y divide-[#1a1a1a]">
            {views.map(view => {
                const ViewRender = view.render;
                const isCollapsed = collapsedViews[view.id];

                return (
                    <div key={view.id} className={`flex flex-col overflow-hidden transition-all ${isCollapsed ? 'flex-none' : 'flex-1 min-h-[150px]'}`}>
                        <div 
                           onClick={() => toggleView(view.id)}
                           className="border-b border-[#222] bg-[#141414] px-2 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[#1a1a1a] select-none transition-colors"
                        >
                           <ChevronRight size={14} className={`text-[#666] transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                           {view.icon}
                           <span className="text-[10px] text-[#999] uppercase font-bold tracking-wider">{t(view.title)}</span>
                        </div>
                        {!isCollapsed && (
                            <div className="flex-1 overflow-hidden relative flex flex-col">
                                <ViewRender />
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    );
}
