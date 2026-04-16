"use client";
import React, { useEffect, useState } from "react";
import { trixty, WebviewView } from "@/api/trixty";
import { useApp } from "@/context/AppContext";

export default function LeftSidebarSlot() {
    const [views, setViews] = useState<WebviewView[]>([]);

    useEffect(() => {
        const update = () => setViews(trixty.window.getLeftPanelViews());
        update();
        return trixty.window.subscribe(update);
    }, []);

    const { activeSidebarTab } = useApp();

    if (views.length === 0) {
        return <div className="flex-1 flex flex-col items-center justify-center text-[#666] text-[11px] p-4 text-center">No Sidebar addons active</div>;
    }

    const activeView = views.find(v => v.id === activeSidebarTab) || views[0];
    if (!activeView) return null;

    const ViewRender = activeView.render;

    return <ViewRender />;
}
