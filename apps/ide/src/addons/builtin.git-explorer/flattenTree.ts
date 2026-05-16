// Pure tree-flattening helper for the Explorer virtualization.
//
// `GitExplorerComponent` keeps the workspace as a nested `FileEntry` tree and
// used to render it via a recursive in-flow JSX walk, producing one DOM node
// per directory/file regardless of viewport. For large workspaces (≈5k+ files
// once a few deep directories are expanded) that dominated paint cost and
// made scrolling janky.
//
// To hand the tree off to `react-virtuoso`, we need a flat list of "visible
// rows" in display order. This module is that flattener: given the tree, the
// current expansion state, and any transient "new file/folder" input row the
// user triggered, it returns the exact row sequence the UI should show, with
// the nesting level each row renders at.
//
// The filter applied to the tree is the one performed at `read_directory`
// time inside the component (via picomatch on `systemSettings.filesExclude`).
// By the time entries reach this helper they've already been filtered, so we
// don't re-apply excludes here — we just walk what the component chose to
// store. Tests pass pre-filtered trees to exercise that contract.

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export interface NewEntryMarker {
  parentPath: string;
  type: "file" | "folder";
}

export type FlatNode =
  | { kind: "entry"; entry: FileEntry; level: number }
  | { kind: "new-entry"; parentPath: string; type: "file" | "folder"; level: number };

/**
 * Walk the expanded tree in display order and emit a flat list of visible
 * rows. Each returned node carries the depth it should be indented at so the
 * virtualized renderer can reproduce the same `padding-left: level * N` the
 * recursive render used.
 *
 * The transient "new entry" input row placement matches the legacy render:
 *   - parentPath === rootPath: appears after all root-level entries.
 *   - parentPath === some expanded directory: appears immediately after that
 *     directory's row, at level+1 (i.e. aligned with where its first child
 *     would render).
 *   - parentPath points to a collapsed directory: the row is NOT emitted; the
 *     legacy UI gated the inline input on `expandedDirs[path]`, and hiding it
 *     until the directory is expanded is the expected behavior.
 */
export function flattenTree(
  entries: FileEntry[],
  expanded: Record<string, boolean>,
  newEntry: NewEntryMarker | null,
  rootPath: string | null,
  level = 0,
): FlatNode[] {
  const out: FlatNode[] = [];

  for (const entry of entries) {
    out.push({ kind: "entry", entry, level });

    if (entry.is_dir && expanded[entry.path]) {
      // New-entry row appears between the parent row and its first child,
      // matching the legacy "render input below the parent" placement.
      if (newEntry && newEntry.parentPath === entry.path) {
        out.push({
          kind: "new-entry",
          parentPath: entry.path,
          type: newEntry.type,
          level: level + 1,
        });
      }
      if (entry.children && entry.children.length > 0) {
        out.push(
          ...flattenTree(entry.children, expanded, newEntry, rootPath, level + 1),
        );
      }
    }
  }

  // Root-level new-entry row: emitted once at the top of the walk so it sits
  // at the bottom of the level-0 fragment, which is where the recursive
  // render used to put it.
  if (level === 0 && newEntry && rootPath && newEntry.parentPath === rootPath) {
    out.push({ kind: "new-entry", parentPath: rootPath, type: newEntry.type, level: 0 });
  }

  return out;
}
