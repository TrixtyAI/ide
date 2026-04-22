import { describe, expect, it } from "vitest";
import { generateAwarenessBlock } from "./awareness";

// Minimal, self-contained fixtures so the test does not depend on the shape
// of `useApp()` or the real Tauri registries.
const baseParams = {
  system: {
    os_name: "Windows",
    os_version: "11 Pro",
    arch: "x86_64",
    app_version: "1.0.10",
    cpu_usage: 12.3,
    memory_usage: 45.6,
  },
  stack: {
    packageManager: "pnpm" as const,
    frameworks: ["Next.js", "React"],
    isTypeScript: true,
  },
  settings: {
    ai: {
      temperature: 0.7,
      systemPrompt: "",
      endpoint: "http://127.0.0.1:11434",
      maxTokens: 2048,
      alwaysAllowTools: false,
      freezeProtection: true,
      deepMode: false,
      keepAlive: 5,
      loadOnStartup: false,
    },
    editor: {
      fontSize: 14,
      fontFamily: "'Fira Code'",
      theme: "trixty-dark",
      lineHeight: 21,
      minimapEnabled: false,
    },
    system: {
      hasCompletedOnboarding: true,
      filesExclude: ["**/node_modules"],
    },
    locale: "es",
  },
  skills: [
    { id: "sk1", name: "Rust", active: true },
    { id: "sk2", name: "Python", active: false },
  ],
  docs: [
    { id: "d1", name: "Tauri v2", active: true },
  ],
  mode: "agent",
  rootPath: "C:\\Proyectos\\ide",
  projectTreeSummary: ["package.json", "src/", "apps/", "README.md"],
  internetAccess: "Enabled",
};

describe("generateAwarenessBlock", () => {
  it("includes system, capability, stack, and workspace sections", () => {
    const out = generateAwarenessBlock(baseParams);
    expect(out).toContain("### ENVIRONMENT_AWARENESS");
    expect(out).toContain("### CAPABILITY_INVENTORY");
    expect(out).toContain("### PROJECT_STACK");
    expect(out).toContain("### IDE_CONFIGURATION");
    expect(out).toContain("### WORKSPACE_AWARENESS");
  });

  it("renders active skills and docs in the capability inventory", () => {
    const out = generateAwarenessBlock(baseParams);
    expect(out).toMatch(/Active Skills.*Rust/);
    expect(out).not.toMatch(/Active Skills.*Python/);
    expect(out).toMatch(/Active Documentation.*Tauri v2/);
  });

  it("uppercases the current mode", () => {
    const out = generateAwarenessBlock({ ...baseParams, mode: "ask" });
    expect(out).toMatch(/Current Mode\*\*: ASK/);
  });

  it("falls back to 'None' when no skills or docs are active", () => {
    const out = generateAwarenessBlock({
      ...baseParams,
      skills: [],
      docs: [],
    });
    expect(out).toMatch(/Active Skills\*\*: None/);
    expect(out).toMatch(/Active Documentation\*\*: None/);
  });

  it("limits the tree preview to 15 entries and adds an ellipsis when truncated", () => {
    const longTree = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
    const out = generateAwarenessBlock({
      ...baseParams,
      projectTreeSummary: longTree,
    });
    expect(out).toMatch(/file0\.ts/);
    expect(out).toMatch(/file14\.ts/);
    expect(out).not.toMatch(/file15\.ts/);
    expect(out).toMatch(/\.\.\./);
  });

  it("reports 'No project open' when rootPath is null", () => {
    const out = generateAwarenessBlock({ ...baseParams, rootPath: null });
    expect(out).toMatch(/Root\*\*: No project open/);
  });

  it("restricts tool availability when rootPath is null even in agent mode", () => {
    const out = generateAwarenessBlock({
      ...baseParams,
      rootPath: null,
      mode: "agent",
    });
    expect(out).toMatch(/Available Tools\*\*: Restricted/);
  });

  it("defaults internetAccess to 'Disabled' when omitted", () => {
    const params = { ...baseParams };
    delete (params as { internetAccess?: string }).internetAccess;
    const out = generateAwarenessBlock(params);
    expect(out).toMatch(/Internet Access\*\*: Disabled/);
  });
});
