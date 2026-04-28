"use client";

import React from "react";
import { useL10n } from "@/hooks/useL10n";

interface Props {
  viewName: string;
}

const DropZoneOverlay: React.FC<Props> = ({ viewName }) => {
  const { t } = useL10n();
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className="absolute inset-0 z-modal pointer-events-none flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500/40 rounded-lg"
    >
      <span className="text-[12px] font-semibold text-blue-200/90 px-3 py-1.5 bg-black/40 rounded-md">
        {t("panel.view.drop_to_redock", { name: viewName })}
      </span>
    </div>
  );
};

export default DropZoneOverlay;
