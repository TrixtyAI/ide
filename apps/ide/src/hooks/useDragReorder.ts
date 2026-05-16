"use client";

import { useCallback, useRef, useState } from "react";

export type DragTarget = "top" | "bottom" | null;

export interface DragRowProps {
  draggable: true;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  "data-drag-target"?: DragTarget;
  "data-dragging"?: boolean;
}

interface UseDragReorderArgs<T> {
  items: T[];
  getId: (item: T) => string | number;
  onReorder: (next: T[]) => void;
  /** When set, only items returning the same group key reorder
   *  with each other. Lets a list with mixed sections (variables
   *  vs comments, deps vs devDeps) constrain drop targets without
   *  needing a separate hook per group. */
  groupKey?: (item: T) => string;
}

interface UseDragReorderReturn<T> {
  getRowProps: (item: T) => DragRowProps;
  draggingId: string | number | null;
}

/**
 * Native HTML5 drag-and-drop reordering for a single list. Returns
 * a `getRowProps` factory each row spreads onto its outer element;
 * the hook tracks the in-flight drag id and the drop indicator
 * position internally so consumers don't have to.
 *
 * Drop semantics: dropping above the target row inserts before it,
 * dropping below inserts after. The threshold is the row's vertical
 * midpoint — same convention every macOS / VSCode list uses.
 */
export function useDragReorder<T>({
  items,
  getId,
  onReorder,
  groupKey,
}: UseDragReorderArgs<T>): UseDragReorderReturn<T> {
  const [draggingId, setDraggingId] = useState<string | number | null>(null);
  const [hoverState, setHoverState] = useState<{
    id: string | number;
    target: Exclude<DragTarget, null>;
  } | null>(null);
  // We can't rely on `dataTransfer.getData` synchronously inside
  // `onDragOver` (Firefox returns "" until drop), so the source row
  // stashes its id on a ref the hover handler can read.
  const dragSourceIdRef = useRef<string | number | null>(null);

  const onDragStart = useCallback(
    (item: T, event: React.DragEvent<HTMLElement>) => {
      const id = getId(item);
      dragSourceIdRef.current = id;
      setDraggingId(id);
      // Setting plain text + 'move' effect lights up the drag image and
      // tells the browser this is a reorder, not a copy.
      event.dataTransfer.effectAllowed = "move";
      try {
        event.dataTransfer.setData("text/plain", String(id));
      } catch {
        // Some browsers refuse setData inside synthetic events. The
        // ref-based fallback covers us.
      }
    },
    [getId],
  );

  const isSameGroup = useCallback(
    (a: T, b: T) => (groupKey ? groupKey(a) === groupKey(b) : true),
    [groupKey],
  );

  const onDragOver = useCallback(
    (item: T, event: React.DragEvent<HTMLElement>) => {
      const sourceId = dragSourceIdRef.current;
      if (sourceId === null) return;
      const targetId = getId(item);
      if (sourceId === targetId) return;
      const sourceItem = items.find((it) => getId(it) === sourceId);
      if (!sourceItem) return;
      if (!isSameGroup(sourceItem, item)) return;

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      const rect = event.currentTarget.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const target: Exclude<DragTarget, null> =
        event.clientY < midpoint ? "top" : "bottom";
      setHoverState((prev) => {
        if (prev && prev.id === targetId && prev.target === target) return prev;
        return { id: targetId, target };
      });
    },
    [getId, isSameGroup, items],
  );

  const onDragLeave = useCallback(
    (item: T, event: React.DragEvent<HTMLElement>) => {
      // `dragleave` fires when the cursor exits the element OR enters
      // a child. We only clear the hover when the new related target
      // is outside the row, so the indicator doesn't flicker every
      // time the cursor crosses a child input.
      const next = event.relatedTarget as Node | null;
      if (next && event.currentTarget.contains(next)) return;
      const targetId = getId(item);
      setHoverState((prev) => (prev && prev.id === targetId ? null : prev));
    },
    [getId],
  );

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
    setHoverState(null);
    dragSourceIdRef.current = null;
  }, []);

  const onDrop = useCallback(
    (item: T, event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      const sourceId = dragSourceIdRef.current;
      const targetId = getId(item);
      const reset = () => {
        setDraggingId(null);
        setHoverState(null);
        dragSourceIdRef.current = null;
      };
      if (sourceId === null || sourceId === targetId) {
        reset();
        return;
      }
      const fromIdx = items.findIndex((it) => getId(it) === sourceId);
      const toIdx = items.findIndex((it) => getId(it) === targetId);
      if (fromIdx === -1 || toIdx === -1) {
        reset();
        return;
      }
      const sourceItem = items[fromIdx];
      const targetItem = items[toIdx];
      if (!isSameGroup(sourceItem, targetItem)) {
        reset();
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const above = event.clientY < rect.top + rect.height / 2;

      const next = items.slice();
      next.splice(fromIdx, 1);
      // After removing the source, the target's index shifts by 1
      // when it was below the source. Recompute the insertion
      // point in the post-removal list.
      const targetIdxAfterRemoval = next.findIndex(
        (it) => getId(it) === targetId,
      );
      const insertionIdx =
        targetIdxAfterRemoval + (above ? 0 : 1);
      next.splice(insertionIdx, 0, sourceItem);

      onReorder(next);
      reset();
    },
    [getId, isSameGroup, items, onReorder],
  );

  const getRowProps = useCallback(
    (item: T): DragRowProps => {
      const id = getId(item);
      const props: DragRowProps = {
        draggable: true,
        onDragStart: (event) => onDragStart(item, event),
        onDragOver: (event) => onDragOver(item, event),
        onDragLeave: (event) => onDragLeave(item, event),
        onDragEnd,
        onDrop: (event) => onDrop(item, event),
      };
      if (hoverState && hoverState.id === id) {
        props["data-drag-target"] = hoverState.target;
      }
      if (draggingId === id) {
        props["data-dragging"] = true;
      }
      return props;
    },
    [
      draggingId,
      hoverState,
      getId,
      onDragStart,
      onDragOver,
      onDragLeave,
      onDragEnd,
      onDrop,
    ],
  );

  return { getRowProps, draggingId };
}
