import React from "react";
import { trixty } from "@/api/trixty";
import GitExplorerComponent from "./GitExplorerComponent";
import { GitBranch, Files, Search } from "lucide-react";

export function activate() {
    trixty.window.registerLeftPanelView({
        id: "explorer",
        title: "explorer.title",
        icon: <Files size={20} strokeWidth={1.5} />,
        render: () => <GitExplorerComponent />
    });

    trixty.window.registerLeftPanelView({
        id: "search",
        title: "search.title",
        icon: <Search size={20} strokeWidth={1.5} />,
        render: () => <GitExplorerComponent />
    });

    trixty.window.registerLeftPanelView({
        id: "git",
        title: "git.title",
        icon: <GitBranch size={20} strokeWidth={1.5} />,
        render: () => <GitExplorerComponent />
    });
}
