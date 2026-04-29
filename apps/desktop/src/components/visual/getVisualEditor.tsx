"use client";

import React from "react";
import type { FileState } from "@/context/FilesContext";

export interface VisualEditorProps {
  file: FileState;
  onChange: (next: string) => void;
}

export interface VisualEditorRegistryEntry {
  /** Stable id for the entry — used as the per-path mode key so a
   *  user's tab choice survives switching files of the same kind. */
  id: string;
  /** React component rendering the visual surface. */
  Component: React.ComponentType<VisualEditorProps>;
  /** Label shown on the sub-tab. */
  label: string;
}

// Lazy-loaded so the visual surfaces (and any heavy children) stay off
// the boot path until the user actually opens a matching file.
const EnvEditor = React.lazy(() => import("./EnvEditor"));
const JsonTreeEditor = React.lazy(() => import("./JsonTreeEditor"));
const JsonGraphEditor = React.lazy(() => import("./JsonGraphEditor"));
const PackageJsonEditor = React.lazy(() => import("./PackageJsonEditor"));

const ENV_NAME_RE = /(^|\.)env(\.[\w-]+)?$/i;

/**
 * Resolve the visual editors registered for the given file. Returns
 * an empty array to mean "Monaco-only" — the source view is the
 * default for everything that does not have a visual surface.
 *
 * Order matters: the first entry is the default tab when the user
 * has no remembered choice yet. `package.json` returns the form
 * editor; generic `.json` files return both the tree (mutable) and
 * the graph (read-only structural overview).
 */
export function getVisualEditor(file: FileState): VisualEditorRegistryEntry[] {
  if (file.type !== "file") return [];
  const name = file.name.toLowerCase();
  if (name === "package.json") {
    return [
      { id: "form", Component: PackageJsonEditor, label: "Form" },
      { id: "graph", Component: JsonGraphEditor, label: "Graph" },
    ];
  }
  if (ENV_NAME_RE.test(name) || name === ".env") {
    return [{ id: "table", Component: EnvEditor, label: "Table" }];
  }
  if (name.endsWith(".json")) {
    return [
      { id: "tree", Component: JsonTreeEditor, label: "Tree" },
      { id: "graph", Component: JsonGraphEditor, label: "Graph" },
    ];
  }
  return [];
}
