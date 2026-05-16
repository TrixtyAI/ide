import { describe, expect, it } from "vitest";
import { generateAwarenessBlock, inferProjectStack } from "./awareness";

// Minimal, self-contained fixtures so the test does not depend on the shape
// of the settings providers or the real Tauri registries.
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
    testRunners: [],
    linters: [],
    formatters: [],
    buildTools: [],
    languages: [],
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
      inlineCompletions: {
        enabled: false,
        model: "",
        debounceMs: 250,
        maxTokens: 64,
      },
      allowProviderKeys: false,
      providerKeys: { openai: "", anthropic: "", gemini: "", openrouter: "" },
      providerModels: { ollama: [], openai: [], anthropic: [], gemini: [], openrouter: [] },
      activeProvider: "ollama" as const,
      lastModelByProvider: {},
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
      updateChannel: "stable" as const,
      discord: {
        enabled: true,
        showDetails: true,
        allowCollaboration: false,
      },
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

  it("renders the new stack fields (languages, test runners, linters, formatters, build tools)", () => {
    const out = generateAwarenessBlock({
      ...baseParams,
      stack: {
        ...baseParams.stack,
        languages: ["Rust", "Python"],
        testRunners: ["vitest", "cargo"],
        linters: ["eslint"],
        formatters: ["prettier", "rustfmt"],
        buildTools: ["turbo"],
      },
    });
    expect(out).toMatch(/Languages\*\*: Rust, Python/);
    expect(out).toMatch(/Test Runners\*\*: vitest, cargo/);
    expect(out).toMatch(/Linters\*\*: eslint/);
    expect(out).toMatch(/Formatters\*\*: prettier, rustfmt/);
    expect(out).toMatch(/Build Tools\*\*: turbo/);
  });

  it("falls back to 'None detected' when stack arrays are empty", () => {
    const out = generateAwarenessBlock(baseParams);
    expect(out).toMatch(/Test Runners\*\*: None detected/);
    expect(out).toMatch(/Linters\*\*: None detected/);
    expect(out).toMatch(/Languages\*\*: None detected/);
  });
});

describe("inferProjectStack", () => {
  it("detects pnpm from pnpm-lock.yaml and TypeScript from tsconfig.json", () => {
    const stack = inferProjectStack({
      fileNames: ["pnpm-lock.yaml", "tsconfig.json", "package.json"],
      packageJson: {},
    });
    expect(stack.packageManager).toBe("pnpm");
    expect(stack.isTypeScript).toBe(true);
  });

  it("detects npm / yarn / bun lockfiles", () => {
    expect(
      inferProjectStack({ fileNames: ["package-lock.json"], packageJson: null })
        .packageManager,
    ).toBe("npm");
    expect(
      inferProjectStack({ fileNames: ["yarn.lock"], packageJson: null })
        .packageManager,
    ).toBe("yarn");
    expect(
      inferProjectStack({ fileNames: ["bun.lockb"], packageJson: null })
        .packageManager,
    ).toBe("bun");
  });

  it("detects frameworks from package.json dependencies", () => {
    const stack = inferProjectStack({
      fileNames: ["package.json"],
      packageJson: {
        dependencies: { next: "^15", react: "^18" },
        devDependencies: { tailwindcss: "^4" },
      },
    });
    expect(stack.frameworks).toContain("Next.js");
    expect(stack.frameworks).toContain("React");
    expect(stack.frameworks).toContain("TailwindCSS");
  });

  it("detects vitest as the test runner", () => {
    const stack = inferProjectStack({
      fileNames: ["package.json"],
      packageJson: {
        devDependencies: { vitest: "^2.1.9" },
      },
    });
    expect(stack.testRunners).toContain("vitest");
  });

  it("detects playwright via either the scoped or unscoped package", () => {
    const a = inferProjectStack({
      fileNames: ["package.json"],
      packageJson: { devDependencies: { "@playwright/test": "^1" } },
    });
    const b = inferProjectStack({
      fileNames: ["package.json"],
      packageJson: { devDependencies: { playwright: "^1" } },
    });
    expect(a.testRunners).toContain("playwright");
    expect(b.testRunners).toContain("playwright");
    // Deduped — we don't double-list playwright even if both were present.
    const both = inferProjectStack({
      fileNames: ["package.json"],
      packageJson: {
        devDependencies: { "@playwright/test": "^1", playwright: "^1" },
      },
    });
    expect(both.testRunners.filter((r) => r === "playwright")).toHaveLength(1);
  });

  it("detects linters and formatters (eslint, biome, prettier)", () => {
    const stack = inferProjectStack({
      fileNames: ["package.json"],
      packageJson: {
        devDependencies: {
          eslint: "^9",
          prettier: "^3",
          "@biomejs/biome": "^1",
        },
      },
    });
    expect(stack.linters).toContain("eslint");
    expect(stack.linters).toContain("biome");
    expect(stack.formatters).toContain("prettier");
    expect(stack.formatters).toContain("biome");
  });

  it("detects build tools beyond next/vite (turbo, nx, webpack, rollup, esbuild)", () => {
    const stack = inferProjectStack({
      fileNames: ["package.json"],
      packageJson: {
        devDependencies: {
          turbo: "^2",
          nx: "^19",
          webpack: "^5",
          rollup: "^4",
          esbuild: "^0.20",
        },
      },
    });
    expect(stack.buildTools).toEqual(
      expect.arrayContaining(["turbo", "nx", "webpack", "rollup", "esbuild"]),
    );
  });

  it("detects Rust via Cargo.toml and implies cargo + rustfmt", () => {
    const stack = inferProjectStack({
      fileNames: ["Cargo.toml", "src"],
      packageJson: null,
    });
    expect(stack.languages).toContain("Rust");
    expect(stack.testRunners).toContain("cargo");
    expect(stack.formatters).toContain("rustfmt");
  });

  it("detects Python via pyproject.toml or requirements.txt", () => {
    const a = inferProjectStack({
      fileNames: ["pyproject.toml"],
      packageJson: null,
    });
    const b = inferProjectStack({
      fileNames: ["requirements.txt"],
      packageJson: null,
    });
    expect(a.languages).toContain("Python");
    expect(b.languages).toContain("Python");
  });

  it("detects Go via go.mod", () => {
    const stack = inferProjectStack({
      fileNames: ["go.mod", "main.go"],
      packageJson: null,
    });
    expect(stack.languages).toContain("Go");
  });

  it("returns empty arrays and 'unknown' package manager for a bare directory", () => {
    const stack = inferProjectStack({ fileNames: [], packageJson: null });
    expect(stack.packageManager).toBe("unknown");
    expect(stack.frameworks).toEqual([]);
    expect(stack.testRunners).toEqual([]);
    expect(stack.languages).toEqual([]);
    expect(stack.isTypeScript).toBe(false);
  });
});
