"use client";

import React from "react";
import type { FileState } from "@/context/FilesContext";

export interface VisualEditorProps {
  file: FileState;
  onChange: (next: string) => void;
}

export interface VisualEditorRegistryEntry {
  /** React component rendering the visual surface. */
  Component: React.ComponentType<VisualEditorProps>;
  /** Label shown on the sub-tab. */
  label: string;
}

// Lazy-loaded so the visual surfaces (and any heavy children) stay off
// the boot path until the user actually opens a matching file.
const EnvEditor = React.lazy(() => import("./EnvEditor"));
const JsonTreeEditor = React.lazy(() => import("./JsonTreeEditor"));
const PackageJsonEditor = React.lazy(() => import("./PackageJsonEditor"));

const ENV_NAME_RE = /(^|\.)env(\.[\w-]+)?$/i;

/**
 * Resolve the visual editor (if any) registered for the given file.
 * Returning `null` keeps the editor area Monaco-only — the source view
 * is the default for everything that does not have a visual surface.
 *
 * Order matters: `package.json` is checked before the generic JSON
 * matcher so the form editor wins over the tree viewer.
 */
export function getVisualEditor(
  file: FileState,
): VisualEditorRegistryEntry | null {
  if (file.type !== "file") return null;
  const name = file.name.toLowerCase();
  if (name === "package.json") {
    return { Component: PackageJsonEditor, label: "Form" };
  }
  if (ENV_NAME_RE.test(name) || name === ".env") {
    return { Component: EnvEditor, label: "Table" };
  }
  if (name.endsWith(".json")) {
    return { Component: JsonTreeEditor, label: "Tree" };
  }
  return null;
}
