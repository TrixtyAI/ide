"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "@/hooks/useClickOutside";
import FloatingPanel from "@/components/ui/FloatingPanel";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick?: () => void;
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
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const previousFocusRef = useRef<Element | null>(null);

  // Indices of items that can actually receive focus (skipping separators and
  // disabled rows). Used by the roving-tabindex logic below.
  const focusableIndices = useMemo(
    () =>
      items
        .map((item, idx) => (item.separator || item.disabled ? -1 : idx))
        .filter((idx) => idx !== -1),
    [items],
  );

  const [activeIndex, setActiveIndex] = useState<number>(
    () => focusableIndices[0] ?? -1,
  );

  useClickOutside(menuRef, onClose);

  // On mount: remember who had focus, move focus into the menu's first
  // activatable item. On unmount: restore focus to the caller so keyboard
  // users are not stranded.
  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    if (focusableIndices.length > 0) {
      const first = focusableIndices[0];
      setActiveIndex(first);
      itemRefs.current[first]?.focus();
    }
    return () => {
      const prev = previousFocusRef.current;
      if (prev instanceof HTMLElement) {
        prev.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("scroll", handleScroll, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const focusItem = (targetIndex: number) => {
    setActiveIndex(targetIndex);
    itemRefs.current[targetIndex]?.focus();
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (focusableIndices.length === 0) return;
    const pos = focusableIndices.indexOf(activeIndex);
    const len = focusableIndices.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(focusableIndices[(pos + 1 + len) % len]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(focusableIndices[(pos - 1 + len) % len]);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(focusableIndices[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(focusableIndices[len - 1]);
    }
  };

  // Adjust position if it goes off screen
  const adjustedX = Math.min(x, typeof window !== "undefined" ? window.innerWidth - 300 : x);
  const adjustedY = Math.min(y, typeof window !== "undefined" ? window.innerHeight - items.length * 45 : y);

  const menuContent = (
    <FloatingPanel
      ref={menuRef}
      role="menu"
      onKeyDown={handleMenuKeyDown}
      shape="menu"
      style={{ top: adjustedY, left: adjustedX }}
      className="fixed z-menu min-w-[16rem] w-max max-w-sm py-1.5 animate-in fade-in zoom-in-95 duration-100"
    >
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {item.separator ? (
            <div role="separator" className="h-[1px] bg-white/5 my-2 mx-2.5" />
          ) : (
            <button
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="menuitem"
              tabIndex={activeIndex === index ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                if (!item.disabled && item.onClick) {
                  item.onClick();
                  onClose();
                }
              }}
              onFocus={() => setActiveIndex(index)}
              disabled={item.disabled}
              className={cn(
                "w-full flex items-center justify-between px-4 py-1.5 text-[12px] transition-all whitespace-nowrap",
                item.disabled
                  ? "opacity-30 cursor-not-allowed"
                  : "text-[#ccc] hover:bg-white/10 hover:text-white cursor-default",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="opacity-70">{item.icon}</span>
                <span className="font-medium tracking-tight text-left">{item.label}</span>
              </div>
              {item.shortcut && (
                <span className="text-[10px] opacity-40 font-mono ml-6 tracking-tighter text-right">{item.shortcut}</span>
              )}
            </button>
          )}
        </React.Fragment>
      ))}
    </FloatingPanel>
  );

  return typeof document !== "undefined" ? createPortal(menuContent, document.body) : menuContent;
};

export default ContextMenu;
