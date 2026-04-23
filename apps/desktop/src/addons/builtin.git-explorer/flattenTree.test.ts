import { describe, expect, it } from "vitest";
import pm from "picomatch";
import { flattenTree, type FileEntry, type NewEntryMarker } from "./flattenTree";

// These tests lock in the contract the virtualized Explorer relies on:
//  - the flat list renders children in depth-first order,
//  - levels are assigned as the recursive render used to indent them,
//  - collapsed subtrees are skipped entirely,
//  - the transient new-entry row appears in the right slot at the right depth.
//
// `rootPath` is a synthetic "/root" throughout so path comparisons stay
// platform-agnostic (no drive letters, no separators to escape).

const ROOT = "/root";

const file = (name: string, parent = ROOT): FileEntry => ({
  name,
  path: `${parent}/${name}`,
  is_dir: false,
});

const dir = (
  name: string,
  children: FileEntry[] | undefined,
  parent = ROOT,
): FileEntry => ({
  name,
  path: `${parent}/${name}`,
  is_dir: true,
  children,
});

describe("flattenTree()", () => {
  it("returns an empty list when there are no entries", () => {
    expect(flattenTree([], {}, null, ROOT)).toEqual([]);
  });

  it("emits a single entry node for a lone root-level file", () => {
    const f = file("readme.md");
    const out = flattenTree([f], {}, null, ROOT);
    expect(out).toEqual([{ kind: "entry", entry: f, level: 0 }]);
  });

  it("skips children of an unexpanded directory", () => {
    const d = dir("src", [file("index.ts", `${ROOT}/src`)]);
    const out = flattenTree([d], {}, null, ROOT);
    // Directory itself is visible, its children are not — collapsed.
    expect(out).toEqual([{ kind: "entry", entry: d, level: 0 }]);
  });

  it("emits children at level+1 when the directory is expanded", () => {
    const child = file("index.ts", `${ROOT}/src`);
    const d = dir("src", [child]);
    const out = flattenTree([d], { [d.path]: true }, null, ROOT);
    expect(out).toEqual([
      { kind: "entry", entry: d, level: 0 },
      { kind: "entry", entry: child, level: 1 },
    ]);
  });

  it("walks nested expansion depth-first with monotonically increasing levels", () => {
    const leaf = file("button.tsx", `${ROOT}/src/ui`);
    const ui = dir("ui", [leaf], `${ROOT}/src`);
    const src = dir("src", [ui]);
    const out = flattenTree(
      [src],
      { [src.path]: true, [ui.path]: true },
      null,
      ROOT,
    );
    expect(out.map((n) => (n.kind === "entry" ? [n.entry.name, n.level] : n))).toEqual([
      ["src", 0],
      ["ui", 1],
      ["button.tsx", 2],
    ]);
  });

  it("renders the root-level new-entry row at the bottom of level 0", () => {
    // Legacy recursive render put the `{newEntry.parentPath === rootPath}`
    // block after `items.map(...)` — keep that placement.
    const a = file("a.ts");
    const b = file("b.ts");
    const marker: NewEntryMarker = { parentPath: ROOT, type: "file" };
    const out = flattenTree([a, b], {}, marker, ROOT);
    expect(out).toEqual([
      { kind: "entry", entry: a, level: 0 },
      { kind: "entry", entry: b, level: 0 },
      { kind: "new-entry", parentPath: ROOT, type: "file", level: 0 },
    ]);
  });

  it("inserts a new-entry row immediately after its expanded parent at level+1", () => {
    const child = file("existing.ts", `${ROOT}/src`);
    const src = dir("src", [child]);
    const sibling = file("package.json");
    const marker: NewEntryMarker = { parentPath: src.path, type: "folder" };
    const out = flattenTree([src, sibling], { [src.path]: true }, marker, ROOT);
    expect(out).toEqual([
      { kind: "entry", entry: src, level: 0 },
      { kind: "new-entry", parentPath: src.path, type: "folder", level: 1 },
      { kind: "entry", entry: child, level: 1 },
      { kind: "entry", entry: sibling, level: 0 },
    ]);
  });

  it("does NOT emit a new-entry row when its parent directory is collapsed", () => {
    // The legacy render gated the inline input on `expandedDirs[e.path]`. A
    // collapsed parent must not leak a phantom input into the flat list.
    const src = dir("src", [file("a.ts", `${ROOT}/src`)]);
    const marker: NewEntryMarker = { parentPath: src.path, type: "file" };
    const out = flattenTree([src], {}, marker, ROOT);
    expect(out).toEqual([{ kind: "entry", entry: src, level: 0 }]);
  });

  it("omits entries that were filtered out upstream at load time", () => {
    // The component pre-filters via picomatch on `systemSettings.filesExclude`
    // inside `loadDirectory`; flattenTree walks whatever the tree holds. This
    // test documents the contract by running the same filter before handing
    // the tree in, and asserting excluded paths don't appear in the output.
    const patterns = ["**/node_modules", "*.log"];
    const isMatch = pm(patterns, { dot: true });

    const allTopLevel: FileEntry[] = [
      file("index.ts"),
      dir("node_modules", [file("react.js", `${ROOT}/node_modules`)]),
      file("build.log"),
      file("README.md"),
    ];
    const filtered = allTopLevel.filter((e) => !isMatch(e.name));

    const out = flattenTree(filtered, {}, null, ROOT);
    const names = out.map((n) => (n.kind === "entry" ? n.entry.name : "(new-entry)"));
    expect(names).toEqual(["index.ts", "README.md"]);
  });
});
