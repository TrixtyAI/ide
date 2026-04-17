import { safeInvoke as invoke, DirEntry } from "@/api/tauri";
import { AISettings, EditorSettings, SystemSettings } from "@/context/AppContext";

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
    console.error("Failed to fetch system info:", err);
    return {
      os_name: "Unknown",
      os_version: "Unknown",
      arch: "Unknown",
      app_version: "Unknown"
    };
  }
}

export async function detectProjectStack(rootPath: string | null): Promise<ProjectStack> {
  const stack: ProjectStack = {
    packageManager: 'unknown',
    frameworks: [],
    isTypeScript: false
  };

  if (!rootPath) return stack;

  try {
    const entries = await invoke("read_directory", { path: rootPath });
    const fileNames = entries.map((e: DirEntry) => e.name);

    // Detect Package Manager
    if (fileNames.includes('pnpm-lock.yaml')) stack.packageManager = 'pnpm';
    else if (fileNames.includes('package-lock.json')) stack.packageManager = 'npm';
    else if (fileNames.includes('yarn.lock')) stack.packageManager = 'yarn';
    else if (fileNames.includes('bun.lockb')) stack.packageManager = 'bun';

    // Detect TypeScript
    if (fileNames.includes('tsconfig.json')) stack.isTypeScript = true;

    // Detect Frameworks from package.json
    if (fileNames.includes('package.json')) {
      const packageJsonContent = await invoke("read_file", { path: `${rootPath}/package.json` });
      const pkg = JSON.parse(packageJsonContent);
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

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
    }
  } catch (err) {
    console.error("Stack detection failed:", err);
  }

  return stack;
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
  mode: string;
  rootPath: string | null;
  projectTreeSummary: string[];
}) {
  const { system, stack, settings, skills, mode, rootPath, projectTreeSummary } = params;

  const activeSkills = skills.filter(s => s.active).map(s => s.name).join(", ") || "None";
  const disabledSkills = skills.filter(s => !s.active).map(s => s.name).join(", ") || "None";

  return `
### ENVIRONMENT_AWARENESS
- **System**: ${system.os_name} ${system.os_version} (${system.arch})
- **System Load**: CPU: ${system.cpu_usage?.toFixed(1)}%, RAM: ${system.memory_usage?.toFixed(1)}%
- **IDE**: Trixty IDE v${system.app_version}
- **Language**: ${settings.locale}

### CAPABILITY_INVENTORY
- **Active Skills**: ${activeSkills}
- **Disabled Skills**: ${disabledSkills}
- **Current Mode**: ${mode.toUpperCase()}
- **Available Tools**: ${rootPath && mode === 'agent' ? "All IDE tools enabled" : "Restricted (No direct execution)"}

### PROJECT_STACK
- **Package Manager**: ${stack.packageManager.toUpperCase()}
- **Technologies**: ${stack.frameworks.join(", ") || "Vanilla / Unknown"}
- **TypeScript**: ${stack.isTypeScript ? "Yes" : "No"}

### IDE_CONFIGURATION
- **AI**: Temperature ${settings.ai.temperature}, MaxTokens ${settings.ai.maxTokens}, Endpoint ${settings.ai.endpoint}
- **Editor**: Theme ${settings.editor.theme}, Font ${settings.editor.fontSize}px ${settings.editor.fontFamily}

### WORKSPACE_AWARENESS
- **Root**: ${rootPath || "No project open"}
- **Structure Preview**: ${projectTreeSummary.slice(0, 15).join(", ")}${projectTreeSummary.length > 15 ? "..." : ""}
`.trim();
}
