import { safeInvoke as invoke, DirEntry } from "@/api/tauri";
import { AISettings, EditorSettings, SystemSettings } from "@/context/SettingsContext";
import { logger } from "@/lib/logger";

export interface SystemInfo {
  os_name: string;
  os_version: string;
  arch: string;
  app_version: string;
  cpu_usage?: number;
  memory_usage?: number;
}

export interface ProjectStack {
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  frameworks: string[];
  isTypeScript: boolean;
  // New in 1.0.11: richer stack awareness so agent + planner modes can pick
  // the right tool (e.g. `pnpm test` vs `cargo test`, `eslint` vs `biome`)
  // without asking the user.
  testRunners: string[];
  linters: string[];
  formatters: string[];
  buildTools: string[];
  languages: string[];
}

export async function getSystemInfo(): Promise<SystemInfo> {
  try {
    const about = await invoke("get_trixty_about_info");
    const health = await invoke("get_system_health");

    return {
      os_name: about.os_name as string,
      os_version: about.os_version as string,
      arch: about.arch as string,
      app_version: about.app_version as string,
      cpu_usage: health.cpu_usage,
      memory_usage: health.memory_usage
    };
  } catch (err) {
    logger.error("Failed to fetch system info:", err);
    return {
      os_name: "Unknown",
      os_version: "Unknown",
      arch: "Unknown",
      app_version: "Unknown"
    };
  }
}

// Pure stack inference. Factored out of the I/O path (`detectProjectStack`)
// so unit tests can exercise the dependency/file-name heuristics without
// mocking the Tauri bridge. All inputs are plain strings / arrays so the
// function is safe to call from the SSR boundary too.
export function inferProjectStack(params: {
  fileNames: string[];
  packageJson?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null;
}): ProjectStack {
  const { fileNames, packageJson } = params;

  const stack: ProjectStack = {
    packageManager: 'unknown',
    frameworks: [],
    isTypeScript: false,
    testRunners: [],
    linters: [],
    formatters: [],
    buildTools: [],
    languages: [],
  };

  // Package manager detection
  if (fileNames.includes('pnpm-lock.yaml')) stack.packageManager = 'pnpm';
  else if (fileNames.includes('package-lock.json')) stack.packageManager = 'npm';
  else if (fileNames.includes('yarn.lock')) stack.packageManager = 'yarn';
  else if (fileNames.includes('bun.lockb') || fileNames.includes('bun.lock')) stack.packageManager = 'bun';

  if (fileNames.includes('tsconfig.json')) stack.isTypeScript = true;

  // Language runtime presence. Ordered most-specific first so the
  // awareness line reads naturally ("Rust, Python, Go").
  const hasPyproject = fileNames.includes('pyproject.toml');
  const hasRequirements = fileNames.includes('requirements.txt');
  if (fileNames.includes('Cargo.toml')) stack.languages.push('Rust');
  if (hasPyproject || hasRequirements) stack.languages.push('Python');
  if (fileNames.includes('go.mod')) stack.languages.push('Go');

  // Rustfmt / cargo test are implied by Cargo.toml even without a dep entry.
  if (fileNames.includes('Cargo.toml')) {
    stack.testRunners.push('cargo');
    stack.formatters.push('rustfmt');
  }
  // Python side: if the project declares pytest via pyproject.toml or
  // requirements.txt we can't cheaply sniff that here, so we only set
  // `pytest` from package.json deps (the frontend case). A richer sniff
  // could read pyproject.toml — deferred to keep this path fast and
  // side-effect-free.
  if (hasPyproject || hasRequirements) {
    // Python lint/format detection lives in config files, not package.json.
    // We add them here when the lockfile surface suggests Python at all;
    // individual tool detection (`ruff`, `black`) is a known deferral.
  }

  // JS-land detection needs package.json.
  if (packageJson) {
    const allDeps: Record<string, string> = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };

    const frameworkMap: Record<string, string> = {
      'next': 'Next.js',
      'vite': 'Vite',
      'react': 'React',
      'vue': 'Vue.js',
      'svelte': 'Svelte',
      'tailwindcss': 'TailwindCSS',
      'express': 'Express',
      'electron': 'Electron',
      'tauri': 'Tauri',
    };

    for (const [dep, label] of Object.entries(frameworkMap)) {
      if (allDeps[dep]) stack.frameworks.push(label);
    }

    const testRunnerDeps: Array<[string, string]> = [
      ['vitest', 'vitest'],
      ['jest', 'jest'],
      ['@playwright/test', 'playwright'],
      ['playwright', 'playwright'],
      ['cypress', 'cypress'],
      ['mocha', 'mocha'],
    ];
    for (const [dep, label] of testRunnerDeps) {
      if (allDeps[dep] && !stack.testRunners.includes(label)) {
        stack.testRunners.push(label);
      }
    }

    const linterDeps: Array<[string, string]> = [
      ['eslint', 'eslint'],
      ['@biomejs/biome', 'biome'],
    ];
    for (const [dep, label] of linterDeps) {
      if (allDeps[dep] && !stack.linters.includes(label)) {
        stack.linters.push(label);
      }
    }

    const formatterDeps: Array<[string, string]> = [
      ['prettier', 'prettier'],
      ['@biomejs/biome', 'biome'],
    ];
    for (const [dep, label] of formatterDeps) {
      if (allDeps[dep] && !stack.formatters.includes(label)) {
        stack.formatters.push(label);
      }
    }

    const buildToolDeps: Array<[string, string]> = [
      ['webpack', 'webpack'],
      ['rollup', 'rollup'],
      ['esbuild', 'esbuild'],
      ['turbo', 'turbo'],
      ['nx', 'nx'],
    ];
    for (const [dep, label] of buildToolDeps) {
      if (allDeps[dep] && !stack.buildTools.includes(label)) {
        stack.buildTools.push(label);
      }
    }
  }

  return stack;
}

export async function detectProjectStack(rootPath: string | null): Promise<ProjectStack> {
  const empty: ProjectStack = {
    packageManager: 'unknown',
    frameworks: [],
    isTypeScript: false,
    testRunners: [],
    linters: [],
    formatters: [],
    buildTools: [],
    languages: [],
  };

  if (!rootPath) return empty;

  try {
    const entries = await invoke("read_directory", { path: rootPath });
    const fileNames = entries.map((e: DirEntry) => e.name);

    let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null = null;
    if (fileNames.includes('package.json')) {
      try {
        const packageJsonContent = await invoke("read_file", { path: `${rootPath}/package.json` });
        packageJson = JSON.parse(packageJsonContent);
      } catch (err) {
        logger.error("Failed to parse package.json for stack detection:", err);
      }
    }

    return inferProjectStack({ fileNames, packageJson });
  } catch (err) {
    logger.error("Stack detection failed:", err);
    return empty;
  }
}

function formatList(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "None detected";
}

export function generateAwarenessBlock(params: {
  system: SystemInfo;
  stack: ProjectStack;
  settings: {
    ai: AISettings;
    editor: EditorSettings;
    system: SystemSettings;
    locale: string;
  };
  skills: { id: string, name: string, active: boolean }[];
  docs: { id: string, name: string, active: boolean }[];
  mode: string;
  rootPath: string | null;
  projectTreeSummary: string[];
  internetAccess?: string;
}) {
  const { system, stack, settings, skills, docs, mode, rootPath, projectTreeSummary, internetAccess } = params;

  const activeSkills = skills.filter(s => s.active).map(s => s.name).join(", ") || "None";
  const activeDocsList = docs.filter(s => s.active).map(s => s.name).join(", ") || "None";

  return `
### ENVIRONMENT_AWARENESS
- **System**: ${system.os_name} ${system.os_version} (${system.arch})
- **System Load**: CPU: ${system.cpu_usage?.toFixed(1)}%, RAM: ${system.memory_usage?.toFixed(1)}%
- **IDE**: Trixty IDE v${system.app_version}
- **Language**: ${settings.locale}

### CAPABILITY_INVENTORY
- **Active Skills**: ${activeSkills}
- **Active Documentation**: ${activeDocsList}
- **Current Mode**: ${mode.toUpperCase()}
- **Internet Access**: ${internetAccess || "Disabled"}
- **Available Tools**: ${rootPath && mode === 'agent' ? "All IDE tools enabled" : "Restricted (No direct execution)"}

### PROJECT_STACK
- **Package Manager**: ${stack.packageManager.toUpperCase()}
- **Technologies**: ${stack.frameworks.join(", ") || "Vanilla / Unknown"}
- **TypeScript**: ${stack.isTypeScript ? "Yes" : "No"}
- **Languages**: ${formatList(stack.languages)}
- **Test Runners**: ${formatList(stack.testRunners)}
- **Linters**: ${formatList(stack.linters)}
- **Formatters**: ${formatList(stack.formatters)}
- **Build Tools**: ${formatList(stack.buildTools)}

### IDE_CONFIGURATION
- **AI**: Temperature ${settings.ai.temperature}, MaxTokens ${settings.ai.maxTokens}, Endpoint ${settings.ai.endpoint}
- **Editor**: Theme ${settings.editor.theme}, Font ${settings.editor.fontSize}px ${settings.editor.fontFamily}

### WORKSPACE_AWARENESS
- **Root**: ${rootPath || "No project open"}
- **Structure Preview**: ${projectTreeSummary.slice(0, 15).join(", ")}${projectTreeSummary.length > 15 ? "..." : ""}
`.trim();
}
