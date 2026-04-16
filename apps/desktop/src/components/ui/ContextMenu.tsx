"use client";

import React, { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Adjust position if it goes off screen
  const adjustedX = Math.min(x, typeof window !== "undefined" ? window.innerWidth - 300 : x);
  const adjustedY = Math.min(y, typeof window !== "undefined" ? window.innerHeight - items.length * 45 : y);

  return (
    <div
      ref={menuRef}
      style={{ top: adjustedY, left: adjustedX }}
      className="fixed z-[1000] w-72 bg-[#121212]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden py-2.5 animate-in fade-in zoom-in-95 duration-100"
    >
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {item.separator ? (
            <div className="h-[1px] bg-white/5 my-2 mx-2.5" />
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!item.disabled) {
                  item.onClick();
                  onClose();
                }
              }}
              disabled={item.disabled}
              className={`
                w-full flex items-center justify-between px-4 py-2.5 text-[13px] transition-all
                ${item.disabled 
                  ? "opacity-30 cursor-not-allowed" 
                  : "text-[#ccc] hover:bg-white/10 hover:text-white cursor-default"}
              `}
            >
              <div className="flex items-center gap-3">
                <span className="opacity-70 scale-110">{item.icon}</span>
                <span className="font-medium tracking-tight">{item.label}</span>
              </div>
              {item.shortcut && (
                <span className="text-[11px] opacity-40 font-mono ml-4 tracking-tighter">{item.shortcut}</span>
              )}
            </button>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default ContextMenu;
