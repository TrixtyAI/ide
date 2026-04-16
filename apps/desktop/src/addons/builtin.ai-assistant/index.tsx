import React from "react";
import { trixty } from "@/api/trixty";
import AiChatComponent from "./AiChatComponent";
import { Sparkles } from "lucide-react";

export function activate() {
    trixty.window.registerRightPanelView({
        id: "trixty.builtin.ai-assistant",
        title: "ai.assistant_title",
        icon: <Sparkles size={16} className="text-[#cccccc]" />,
        render: () => <AiChatComponent />
    });
}
