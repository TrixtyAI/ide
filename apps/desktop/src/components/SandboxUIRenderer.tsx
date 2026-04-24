"use client";

/**
 * React renderer for the declarative UI schema pushed out of a sandboxed
 * extension worker. Given a `getSchema` / `subscribe` pair plus an
 * `emit` callback, this component re-renders whenever the worker pushes
 * a new schema and wires up synthetic event handlers that post back
 * through `emit` with the handler id the worker assigned.
 *
 * Why `useSyncExternalStore`:
 * - The schema lives outside React state — it's a mutable cell inside
 *   the sandbox host closure. `useSyncExternalStore` is the idiomatic
 *   way to subscribe to external, non-React state without tearing in
 *   concurrent renders.
 * - On SSR / Next's build-time prerender of `/_not-found`, the
 *   `getServerSnapshot` fallback returns an empty schema so the
 *   component doesn't explode when there is no worker to subscribe to.
 *   This matches the pattern used elsewhere in the app (see
 *   `useL10n.ts`).
 */

import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import * as LucideIcons from "lucide-react";
import { logger } from "@/lib/logger";
import type { UiNode, UiProps } from "@/api/sandbox/uiSchema";

export interface SandboxUIRendererProps {
  getSchema(): UiNode;
  subscribe(listener: () => void): () => void;
  emit(handlerId: string, args: unknown[]): void;
}

const EMPTY_SCHEMA: UiNode = { tag: "div" };

function getServerSchema(): UiNode {
  return EMPTY_SCHEMA;
}

export default function SandboxUIRenderer({ getSchema, subscribe, emit }: SandboxUIRendererProps) {
  const schema = useSyncExternalStore(subscribe, getSchema, getServerSchema);

  const emitRef = useCallback(
    (handlerId: string | undefined, args: unknown[]) => {
      if (!handlerId) return;
      try {
        emit(handlerId, args);
      } catch (e) {
        logger.error("[sandbox-ui] emit failed", e);
      }
    },
    [emit],
  );

  return useMemo(() => renderNode(schema, emitRef, "root"), [schema, emitRef]);
}

function renderNode(
  node: UiNode,
  emit: (handlerId: string | undefined, args: unknown[]) => void,
  key: string,
): React.ReactNode {
  if (!node) return null;
  const props = node.props ?? {};

  // Build the React-prop object incrementally so we never pass an
  // unexpected key to the DOM. `UiProps` already forbids unknown keys,
  // but defense in depth is cheap.
  const reactProps: Record<string, unknown> = { key: node.key ?? key };
  if (props.className) reactProps.className = props.className;
  if (props.id) reactProps.id = props.id;
  if (props["aria-label"]) reactProps["aria-label"] = props["aria-label"];
  if (props.role) reactProps.role = props.role;
  if (props.placeholder) reactProps.placeholder = props.placeholder;
  if (props.value !== undefined) reactProps.value = props.value;
  if (props.disabled !== undefined) reactProps.disabled = props.disabled;
  if (props.type) reactProps.type = props.type;

  // Interactive handlers — we wrap the string handler id in a real
  // function so React's event system calls back into `emit`.
  if (props.onClick) {
    reactProps.onClick = () => emit(props.onClick, []);
  }
  if (props.onChange) {
    reactProps.onChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Only ship the primitive value across the wire — the real DOM
      // event carries the native node, which cannot be structured-
      // cloned to the worker anyway.
      emit(props.onChange, [{ value: event.target.value }]);
    };
  }
  if (props.onInput) {
    reactProps.onInput = (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      emit(props.onInput, [{ value: (event.target as HTMLInputElement).value }]);
    };
  }

  const children = normaliseChildren(node.children, emit, key);

  if (node.tag === "icon") {
    return renderIconNode(props, reactProps.key as string);
  }

  // React's type for `createElement` requires the tag to be a valid
  // intrinsic string. We already constrained `node.tag` via the schema
  // validator, so the cast to `keyof JSX.IntrinsicElements` is safe.
  return React.createElement(
    node.tag,
    reactProps,
    ...(Array.isArray(children) ? children : children !== undefined ? [children] : []),
  );
}

function normaliseChildren(
  children: UiNode["children"],
  emit: (handlerId: string | undefined, args: unknown[]) => void,
  parentKey: string,
): React.ReactNode {
  if (children === undefined || children === null) return null;
  if (typeof children === "string" || typeof children === "number") return children;
  if (!Array.isArray(children)) return null;
  return children.map((child, idx) => {
    if (typeof child === "string" || typeof child === "number") {
      return child;
    }
    return renderNode(child, emit, `${parentKey}.${idx}`);
  });
}

function renderIconNode(props: UiProps, key: string): React.ReactNode {
  const name = props.iconName;
  if (!name) return null;
  const iconMap = LucideIcons as unknown as Record<
    string,
    React.ComponentType<{ size?: number; className?: string }> | undefined
  >;
  const Component = iconMap[name];
  if (!Component) {
    // Render nothing — a missing icon shouldn't crash the panel. Extensions
    // that ship in-tree should fall back to a text label or omit the node.
    return null;
  }
  return React.createElement(Component, {
    key,
    size: props.iconSize ?? 14,
    className: props.className,
  });
}
