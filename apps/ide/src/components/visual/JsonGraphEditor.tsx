"use client";

import React, { useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { VisualEditorProps } from "./getVisualEditor";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 44;
const HORIZONTAL_GAP = 80;
const VERTICAL_GAP = 12;
const SIZE_GUARD_BYTES = 512 * 1024;

type JsonNodeKind = "object" | "array" | "primitive";

interface BuildContext {
  nextId: number;
  nodes: Node[];
  edges: Edge[];
}

interface SubtreeMetrics {
  rootId: string;
  totalHeight: number;
}

/**
 * Render a JSON document as a left-to-right tree of nodes, JSON Crack
 * style. Each object / array becomes a parent node carrying a summary
 * line; each child key + primitive becomes a leaf row in its own
 * `<JsonValueNode>`. Edges encode parent → child relationships so a
 * `react-flow` instance can render the graph with pan / zoom out of
 * the box.
 *
 * Read-only: the node bodies are spans, not inputs. The user gets
 * structural insight without losing the source view's full edit
 * fidelity. For mutation, `JsonTreeEditor` (registered alongside this
 * one) stays the right surface.
 */
const JsonGraphEditor: React.FC<VisualEditorProps> = ({ file }) => {
  const parseResult = useMemo(() => parseSafely(file.content), [file.content]);

  const layout = useMemo(() => {
    if (!parseResult.ok) return { nodes: [], edges: [] };
    if (file.content.length > SIZE_GUARD_BYTES) {
      return { nodes: [], edges: [] };
    }
    const ctx: BuildContext = { nextId: 0, nodes: [], edges: [] };
    buildSubtree(ctx, parseResult.value, "$", 0, 0);
    return { nodes: ctx.nodes, edges: ctx.edges };
  }, [parseResult, file.content.length]);

  if (!parseResult.ok) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[#888] text-[12px] p-6 text-center gap-3">
        <span className="text-[11px] uppercase tracking-wider text-[#555]">
          Parse error
        </span>
        <span>
          {parseResult.error}
        </span>
        <span className="text-[10px] text-[#555]">
          Switch back to the source view, fix the syntax, and the graph
          will re-render automatically.
        </span>
      </div>
    );
  }

  if (file.content.length > SIZE_GUARD_BYTES) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[#888] text-[12px] p-6 text-center gap-3">
        <span className="text-[11px] uppercase tracking-wider text-[#555]">
          File is too large for the graph view
        </span>
        <span>
          {(file.content.length / 1024).toFixed(0)} KB exceeds the{" "}
          {SIZE_GUARD_BYTES / 1024} KB safety cap. The full source view stays
          available.
        </span>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[#0a0a0a]">
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnPinch
        minZoom={0.1}
        maxZoom={2}
      >
        <Background color="#1a1a1a" gap={24} size={1} />
        <Controls
          showInteractive={false}
          className="!bg-[#0e0e0e] !border-[#1a1a1a] [&_button]:!bg-[#0e0e0e] [&_button]:!border-[#1a1a1a] [&_button]:!text-[#888]"
        />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(0,0,0,0.6)"
          nodeColor="#222"
          className="!bg-[#0e0e0e] !border !border-[#1a1a1a]"
        />
      </ReactFlow>
    </div>
  );
};

function parseSafely(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: text.trim().length > 0 ? JSON.parse(text) : null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function buildSubtree(
  ctx: BuildContext,
  value: unknown,
  label: string,
  x: number,
  y: number,
): SubtreeMetrics {
  const id = `n${ctx.nextId++}`;
  const kind: JsonNodeKind = Array.isArray(value)
    ? "array"
    : typeof value === "object" && value !== null
      ? "object"
      : "primitive";

  if (kind === "primitive") {
    ctx.nodes.push({
      id,
      type: "default",
      position: { x, y },
      data: { label: <PrimitiveNode label={label} value={value} /> },
      style: nodeStyle(),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
    return { rootId: id, totalHeight: NODE_HEIGHT };
  }

  // Object / array — render the parent row with a summary, then walk each
  // child. Children are placed `NODE_WIDTH + HORIZONTAL_GAP` to the right
  // and stacked vertically with `VERTICAL_GAP` between subtrees.
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);

  const childX = x + NODE_WIDTH + HORIZONTAL_GAP;
  let childY = y;
  let totalChildHeight = 0;
  const childMetrics: SubtreeMetrics[] = [];

  for (const [key, child] of entries) {
    const metrics = buildSubtree(ctx, child, key, childX, childY);
    childMetrics.push(metrics);
    childY += metrics.totalHeight + VERTICAL_GAP;
    totalChildHeight += metrics.totalHeight + VERTICAL_GAP;
  }
  if (entries.length > 0) totalChildHeight -= VERTICAL_GAP;

  const ownHeight = NODE_HEIGHT;
  const subtreeHeight = Math.max(ownHeight, totalChildHeight);
  const ownY = y + (subtreeHeight - ownHeight) / 2;

  ctx.nodes.push({
    id,
    type: "default",
    position: { x, y: ownY },
    data: {
      label: (
        <ContainerNode
          label={label}
          kind={kind}
          count={entries.length}
        />
      ),
    },
    style: nodeStyle(true),
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  });

  for (const child of childMetrics) {
    ctx.edges.push({
      id: `${id}-${child.rootId}`,
      source: id,
      target: child.rootId,
      type: "smoothstep",
      style: { stroke: "#333" },
    });
  }

  return { rootId: id, totalHeight: subtreeHeight };
}

const PrimitiveNode: React.FC<{ label: string; value: unknown }> = ({
  label,
  value,
}) => {
  const [text, color] = primitiveDisplay(value);
  return (
    <div className="text-left flex flex-col gap-0.5 p-1.5">
      <span className="text-[10px] font-mono text-[#888] truncate">
        {label}
      </span>
      <span
        className="text-[11px] font-mono truncate max-w-[200px]"
        style={{ color }}
      >
        {text}
      </span>
    </div>
  );
};

const ContainerNode: React.FC<{
  label: string;
  kind: "object" | "array";
  count: number;
}> = ({ label, kind, count }) => (
  <div className="text-left flex flex-col gap-0.5 p-1.5">
    <span className="text-[10px] font-mono text-[#888] truncate">{label}</span>
    <span className="text-[11px] font-mono text-white">
      {kind === "array" ? `[ ${count} item${count === 1 ? "" : "s"} ]` : `{ ${count} key${count === 1 ? "" : "s"} }`}
    </span>
  </div>
);

function primitiveDisplay(value: unknown): [string, string] {
  if (value === null) return ["null", "#777"];
  switch (typeof value) {
    case "string":
      return [`"${value}"`, "#a3e7a3"];
    case "number":
      return [String(value), "#7cb7ff"];
    case "boolean":
      return [String(value), "#e7c47c"];
    default:
      return [String(value), "#ccc"];
  }
}

function nodeStyle(isContainer = false): React.CSSProperties {
  return {
    background: isContainer ? "#101010" : "#0e0e0e",
    border: `1px solid ${isContainer ? "#333" : "#222"}`,
    borderRadius: 8,
    padding: 0,
    width: NODE_WIDTH,
    color: "#ccc",
  };
}

export default JsonGraphEditor;
