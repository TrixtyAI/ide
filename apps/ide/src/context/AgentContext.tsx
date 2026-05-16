"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { safeInvoke as invoke } from "@/api/tauri";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useCollaboration } from "@/context/CollaborationContext";
import { CORE_IDENTITY, CORE_SOUL } from "@/addons/builtin.agent-support/index";
import { trixty } from "@/api/trixty";
import { logger } from "@/lib/logger";

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  content: string;
  path: string;
}

interface DocInfo {
  id: string;
  name: string;
  description: string;
  content: string; // The content of index.md
  path: string;
}

interface AgentContextType {
  identity: string;
  soul: string;
  agents: string;
  userContext: string;
  tools: string;
  memory: string;
  plan: string;
  design: string;
  skills: SkillInfo[];
  activeSkills: string[];
  docs: DocInfo[];
  activeDocs: string[];
  isLoading: boolean;

  refreshAgentData: () => Promise<void>;
  toggleSkill: (skillId: string) => void;
  toggleDoc: (docId: string) => void;
  saveAgentFile: (fileName: 'AGENTS.md' | 'USER.md' | 'MEMORY.md' | 'TOOLS.md' | 'DESIGN.md', content: string) => Promise<void>;
  setPlan: (content: string) => Promise<void>;
  clearPlan: () => Promise<void>;

  aggregatedPrompt: string;
  chatMode: 'agent' | 'planner' | 'ask';
  setChatMode: (mode: 'agent' | 'planner' | 'ask') => void;
  getSystemPrompt: () => string;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { rootPath } = useWorkspace();
  
  const [agents, setAgents] = useState("");
  const [userContext, setUserContext] = useState("");
  const [tools, setTools] = useState("");
  const [memory, setMemory] = useState("");
  const [plan, setPlanState] = useState("");
  const [design, setDesign] = useState("");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [activeDocs, setActiveDocs] = useState<string[]>([]);
  const [chatMode, _setChatMode] = useState<'agent' | 'planner' | 'ask'>('agent');
  const [isLoading, setIsLoading] = useState(false);
  const { isCollaborating, role, ydoc } = useCollaboration();

  // Monotonic counter used by `refreshAgentData` to discard late responses from
  // previous refreshes. Every refresh claims a new id on entry and only writes
  // state while it is still the most recent refresh in flight.
  const refreshIdRef = useRef(0);

  const loadFile = useCallback(async (name: string) => {
    if (!rootPath) return "";
    const path = `${rootPath}/.agents/${name}`;
    try {
      return await invoke("read_file", { path }, { silent: true });
    } catch {
      // It's okay if file doesn't exist
      return "";
    }
  }, [rootPath]);

  const loadSkills = useCallback(async () => {
    if (!rootPath) return [];
    try {
      const skillsPath = `${rootPath}/.agents/skills`;
      const directories = await invoke("read_directory", { path: skillsPath }, { silent: true });
      
      const skillPromises = directories
        .filter((d: { is_dir: boolean }) => d.is_dir)
        .map(async (d: { path: string, name: string }) => {
          try {
            const skillMdPath = `${d.path}/SKILL.md`;
            const content = await invoke("read_file", { path: skillMdPath }, { silent: true });
            
            return {
              id: d.name,
              name: d.name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
              description: `Conocimiento modular para ${d.name}`,
              content,
              path: skillMdPath
            };
          } catch {
            return null;
          }
        });
        
      const results = await Promise.all(skillPromises);
      return results.filter((s): s is SkillInfo => s !== null);
    } catch {
      return [];
    }
  }, [rootPath]);

  const loadDocs = useCallback(async () => {
    if (!rootPath) return [];
    try {
      const docsPath = `${rootPath}/.agents/doc`;
      const directories = await invoke("read_directory", { path: docsPath }, { silent: true });
      
      const docPromises = directories
        .filter((d: { is_dir: boolean }) => d.is_dir)
        .map(async (d: { path: string, name: string }) => {
          try {
            const indexMdPath = `${d.path}/index.md`;
            const content = await invoke("read_file", { path: indexMdPath }, { silent: true });
            
            return {
              id: d.name,
              name: d.name.toUpperCase(),
              description: `Documentación local para ${d.name}`,
              content,
              path: indexMdPath
            };
          } catch {
            return null;
          }
        });
        
      const results = await Promise.all(docPromises);
      return results.filter((s): s is DocInfo => s !== null);
    } catch {
      return [];
    }
  }, [rootPath]);

  const setChatMode = useCallback((mode: 'agent' | 'planner' | 'ask') => {
    _setChatMode(mode);
    import("@/api/store").then(({ trixtyStore }) => {
      trixtyStore.set("trixty-chat-mode", mode);
    });
  }, []);

  const saveProjectSettings = useCallback(async (activeSkills: string[], activeDocs: string[]) => {
    if (!rootPath) return;
    const path = `${rootPath}/.agents/settings.json`;
    const settings = { activeSkills, activeDocs };
    try {
      await invoke("write_file", { path, content: JSON.stringify(settings, null, 2) });
    } catch (e) {
      logger.error("[AgentContext] Failed to save project settings:", e);
    }
  }, [rootPath]);

  const loadProjectSettings = useCallback(async () => {
    if (!rootPath) return { activeSkills: [], activeDocs: [] };
    const path = `${rootPath}/.agents/settings.json`;
    try {
      const content = await invoke("read_file", { path }, { silent: true });
      return JSON.parse(content);
    } catch {
      return { activeSkills: [], activeDocs: [] };
    }
  }, [rootPath]);

  const refreshAgentData = useCallback(async () => {
    const myId = ++refreshIdRef.current;
    const isStale = () => refreshIdRef.current !== myId;

    setIsLoading(true);
    try {
      const { trixtyStore } = await import("@/api/store");
      const globalUserContent = await trixtyStore.get<string>("trixty-agent-user-context", "");
      if (isStale()) return;
      setUserContext(globalUserContent);

      // Migration and validation: normalize legacy/invalid persisted chat modes before using them.
      const rawMode = await trixtyStore.get<string>("trixty-chat-mode", "agent");
      if (isStale()) return;
      const allowedModes = ["agent", "planner", "ask"] as const;
      const normalizedMode = rawMode === "planer" ? "planner" : rawMode;
      const savedMode: "agent" | "planner" | "ask" = allowedModes.includes(
        normalizedMode as (typeof allowedModes)[number]
      )
        ? (normalizedMode as "agent" | "planner" | "ask")
        : "agent";
      if (rawMode !== savedMode) {
        await trixtyStore.set("trixty-chat-mode", savedMode);
        if (isStale()) return;
      }
      _setChatMode(savedMode);

      if (!rootPath) {
        setAgents("");
        setTools("");
        setMemory("");
        setPlanState("");
        setSkills([]);
        return;
      }

      // Check if .agents directory exists first to avoid noisy console errors from safeInvoke
      let agentsDirMissing = false;
      try {
        await invoke("read_directory", { path: `${rootPath}/.agents` }, { silent: true });
      } catch {
        agentsDirMissing = true;
      }
      if (isStale()) return;
      if (agentsDirMissing) {
        // .agents folder likely doesn't exist, clear local project state and exit
        setAgents("");
        setTools("");
        setMemory("");
        setPlanState("");
        setSkills([]);
        return;
      }

      const [agentsContent, toolsContent, memoryContent, planContent, designContent, discoveredSkills, discoveredDocs] = await Promise.all([
        loadFile("AGENTS.md"),
        loadFile("TOOLS.md"),
        loadFile("MEMORY.md"),
        loadFile("PLAN.md"),
        loadFile("DESIGN.md"),
        loadSkills(),
        loadDocs()
      ]);
      if (isStale()) return;

      setAgents(agentsContent);
      setTools(toolsContent);
      setMemory(memoryContent);
      setPlanState(planContent);
      setDesign(designContent);
      setSkills(discoveredSkills);
      setDocs(discoveredDocs);

      // Restore active states from project settings
      const settings = await loadProjectSettings();
      if (isStale()) return;

      // Update local state (filtering out IDs that might no longer exist)
      const validSkills = settings.activeSkills.filter((id: string) => discoveredSkills.some(s => s.id === id));
      const validDocs = settings.activeDocs.filter((id: string) => discoveredDocs.some(d => d.id === id));

      setActiveSkills(validSkills);
      setActiveDocs(validDocs);

      // Sync registry
      validSkills.forEach((id: string) => trixty.agent.registerSkill(id));
      validDocs.forEach((id: string) => trixty.agent.registerDoc(id));
    } catch (err) {
      logger.error("[AgentContext] Error refreshing agent data:", err);
    } finally {
      // Only clear the loading flag if we're still the most recent refresh —
      // otherwise the newer refresh will do it when it finishes.
      if (!isStale()) {
        setIsLoading(false);
      }
    }
  }, [rootPath, loadFile, loadSkills, loadDocs, loadProjectSettings]);

  // Lock modes if no rootPath
  useEffect(() => {
    if (!rootPath && (chatMode === 'agent' || chatMode === 'planner')) {
      setChatMode('ask');
    }
  }, [rootPath, chatMode, setChatMode]);

  useEffect(() => {
    refreshAgentData();
  }, [rootPath, refreshAgentData]);

  // Yjs Sync for Agent State
  useEffect(() => {
    if (!isCollaborating || !ydoc) return;

    const agentMeta = ydoc.getMap("agent-meta");

    if (role === "host") {
      agentMeta.set("chatMode", chatMode);
      agentMeta.set("isLoading", isLoading);
    } else {
      const updateFromY = () => {
        const remoteMode = agentMeta.get("chatMode") as 'agent' | 'planner' | 'ask';
        if (remoteMode) _setChatMode(remoteMode);
        
        const remoteLoading = agentMeta.get("isLoading") as boolean;
        if (remoteLoading !== undefined) setIsLoading(remoteLoading);
      };
      agentMeta.observe(updateFromY);
      updateFromY();
      return () => agentMeta.unobserve(updateFromY);
    }
  }, [isCollaborating, role, ydoc, chatMode, isLoading]);

  const toggleSkill = useCallback((skillId: string) => {
    setActiveSkills(prev => {
      const isActive = prev.includes(skillId);
      const next = isActive ? prev.filter(id => id !== skillId) : [...prev, skillId];
      
      // Sync with global trixty.agent registry
      if (isActive) {
        trixty.agent.unregisterSkill(skillId);
      } else {
        trixty.agent.registerSkill(skillId);
      }
      
      // Persist
      saveProjectSettings(next, activeDocs);
      
      return next;
    });
  }, [saveProjectSettings, activeDocs]);

  const toggleDoc = useCallback((docId: string) => {
    setActiveDocs(prev => {
      const isActive = prev.includes(docId);
      const next = isActive ? prev.filter(id => id !== docId) : [...prev, docId];
      
      // Sync with global trixty.agent registry
      if (isActive) {
        trixty.agent.unregisterDoc(docId);
      } else {
        trixty.agent.registerDoc(docId);
      }
      
      // Persist
      saveProjectSettings(activeSkills, next);
      
      return next;
    });
  }, [saveProjectSettings, activeSkills]);

  // Persist the planner's active task checklist to `.agents/PLAN.md`.
  // Kept separate from `saveAgentFile` because PLAN.md has a distinct
  // lifecycle (task-scoped, transient) versus the other aggregated docs
  // (project-scoped, long-lived). `clearPlan` deletes the file so stale
  // plans don't bleed into future sessions.
  const setPlan = useCallback(async (content: string) => {
    if (!rootPath) return;
    const path = `${rootPath}/.agents/PLAN.md`;
    try {
      await invoke("write_file", { path, content });
      setPlanState(content);
    } catch (err) {
      logger.error("[AgentContext] Failed to save PLAN.md:", err);
      throw err;
    }
  }, [rootPath]);

  const clearPlan = useCallback(async () => {
    setPlanState("");
    if (!rootPath) return;
    const path = `${rootPath}/.agents/PLAN.md`;
    try {
      // Best-effort delete. If the file never existed (user clicked Clear
      // on an empty state) we still swallow the error — the UI has already
      // cleared local state and the user gets the desired outcome.
      await invoke("delete_path", { path }, { silent: true });
    } catch (err) {
      logger.warn("[AgentContext] PLAN.md delete failed (likely missing):", err);
    }
  }, [rootPath]);

  const saveAgentFile = useCallback(async (fileName: string, content: string) => {
    try {
      if (fileName === "USER.md") {
        const { trixtyStore } = await import("@/api/store");
        await trixtyStore.set("trixty-agent-user-context", content);
        setUserContext(content);
        return;
      }

      if (!rootPath) return;
      const path = `${rootPath}/.agents/${fileName}`;
      await invoke("write_file", { path, content });
      
      // Update local state
      if (fileName === "AGENTS.md") setAgents(content);
      if (fileName === "MEMORY.md") setMemory(content);
      if (fileName === "TOOLS.md") setTools(content);
      if (fileName === "DESIGN.md") setDesign(content);
    } catch (err) {
      logger.error(`[AgentContext] Error saving ${fileName}:`, err);
      throw err;
    }
  }, [rootPath]);

  const localDocContext = useMemo(() => {
    // Add active documentations (indexes)
    const activeDocContents = docs
      .filter(d => activeDocs.includes(d.id))
      .map(d => `#### MODULE: ${d.id}\n${d.content}\n*Path to details: ${rootPath}/.agents/doc/${d.id}/*`)
      .join("\n\n");

    if (!activeDocContents) return "";

    return `### LOCAL_DOCUMENTATION (Source of Truth)
The following modules are part of this project's specialized knowledge. 
- **PRECEDENCE**: Local documentation ALWAYS overrides your pre-trained knowledge. If the docs mention something your training data doesn't (like custom hooks), the local docs are correct.
- **PROCEDURE**: Do NOT answer based on memory. You MUST use 'read_file' to access the detailed .md files listed in the indexes below before responding to questions about these topics.
- **AUTONOMY**: Never ask the user for permission to read these files. Just do it.

${activeDocContents}\n\n`;
  }, [docs, activeDocs, rootPath]);

  const aggregatedPrompt = useMemo(() => {
    let prompt = `${CORE_IDENTITY}\n\n${CORE_SOUL}\n\n`;
    
    if (agents) {
      prompt += `### AGENTS.md (Operating Manual)\n${agents}\n\n`;
    }
    
    // Add active skills
    const activeSkillContents = skills
      .filter(s => activeSkills.includes(s.id))
      .map(s => `### SKILL: ${s.name}\n${s.content}`)
      .join("\n\n");
      
    if (activeSkillContents) {
      prompt += `${activeSkillContents}\n\n`;
    }

    prompt += localDocContext;

    if (userContext) {
      prompt += `### USER.md (User Context)\n${userContext}\n\n`;
    }

    // PLAN.md comes BEFORE MEMORY.md on purpose: when a planner-produced
    // checklist is active, the agent should follow it even if older memory
    // suggests a different path. Task-scoped decisions take precedence.
    if (plan) {
      prompt += `### PLAN.md (Active task checklist)\n${plan}\n\n`;
    }

    if (memory) {
      prompt += `### MEMORY.md (Persistent Memory)\n${memory}\n\n`;
    }

    if (tools) {
      prompt += `### TOOLS.md (Tool Rules)\n${tools}\n\n`;
    }

    if (design) {
      prompt += `### DESIGN.md (Visual & Design Guidelines)\n${design}\n\n`;
    }

    return prompt;
  }, [agents, userContext, tools, memory, plan, skills, activeSkills, design, localDocContext]);

  const getSystemPrompt = useCallback(() => {
    const base = aggregatedPrompt;
    
    if (chatMode === 'planner') {
      return `${base}
### AGENT MODE: PLANNER (Architect)
- STICKY RULE: You MUST NOT execute any tools.
- YOUR GOAL: Break down the user's request into a high-level technical plan.
- MEMORY MANAGEMENT: Include specific steps to update ".agents/MEMORY.md" in your plans whenever a structural decision or important change is proposed.
- OUTPUT FORMAT: Use markers like "Implementation Plan" or "TODO List".
- PLAN PERSISTENCE: When your plan is concrete (specific file paths, specific function names, verifiable acceptance criteria), emit the final plan as Markdown and explicitly include a fenced block tagged \`\`\`plan ... \`\`\` containing the checklist. The IDE will extract and persist it to .agents/PLAN.md automatically, making it visible to Agent mode on the next run.
- HAND-OFF: When your plan is complete and valid, YOU MUST explicitly tell the user: "I have finished the plan. Please switch to Agent mode if you are ready to proceed with the automated execution."
- BOUNDARY: If the user asks you to "do" or "write" code directly, remind them that you are in Planner mode and only design the strategy.`;
    }

    if (chatMode === 'ask') {
      return `${CORE_IDENTITY}
${userContext ? `### USER.md (User Context)\n${userContext}\n\n` : ''}
${localDocContext}
### AGENT MODE: ASK (Quick Assistant)
- YOUR GOAL: Provide direct, concise answers to technical or general questions.
- STICKY RULE: No tools, no complex planning artifacts.
- CONTEXT: Use project files only for reference if strictly necessary. 
- BOUNDARY: If the user asks for action or architectural planning, suggest switching to Agent or Planner mode.`;
    }

    // Default AGENT mode
    return `${base}
### AGENT MODE: AGENT (Execution)
- YOUR GOAL: Execute the tasks using your available IDE tools.
- MEMORY MANAGEMENT: You are responsible for maintaining ".agents/MEMORY.md". Update it autonomously using your file tools whenever you make an important technical decision, complete a task, or change the architecture. Keep it concise.
- PLAN FOLLOW-THROUGH: If a PLAN.md section is in your context above, follow it step by step. Mark steps completed by updating PLAN.md via the write_file tool so progress is visible across sessions.
- WORKFLOW: Synchronize with project files, execute commands, and fulfill the requested changes.
- COMPLEXITY RULE: If a task seems too large or architectural, suggest switching to Planner mode before executing.`;
  }, [aggregatedPrompt, chatMode, localDocContext, userContext]);

  // Memoize the context value so consumers don't re-render on every parent
  // render. `useWorkspace()` only invalidates when the root path changes,
  // which keeps the agent context off the keystroke-edit render path.
  const value = useMemo(() => ({
    identity: CORE_IDENTITY,
    soul: CORE_SOUL,
    agents,
    userContext,
    tools,
    memory,
    plan,
    design,
    skills,
    activeSkills,
    docs,
    activeDocs,
    isLoading,
    refreshAgentData,
    toggleSkill,
    toggleDoc,
    saveAgentFile,
    setPlan,
    clearPlan,
    aggregatedPrompt,
    chatMode,
    setChatMode,
    getSystemPrompt,
  }), [
    agents,
    userContext,
    tools,
    memory,
    plan,
    design,
    skills,
    activeSkills,
    docs,
    activeDocs,
    isLoading,
    refreshAgentData,
    toggleSkill,
    toggleDoc,
    saveAgentFile,
    setPlan,
    clearPlan,
    aggregatedPrompt,
    chatMode,
    setChatMode,
    getSystemPrompt,
  ]);

  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
};

export const useAgent = () => {
  const context = useContext(AgentContext);
  if (!context) throw new Error("useAgent must be used within an AgentProvider");
  return context;
};
