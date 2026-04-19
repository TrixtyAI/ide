"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { safeInvoke as invoke } from "@/api/tauri";
import { useApp } from "@/context/AppContext";
import { CORE_IDENTITY, CORE_SOUL } from "@/addons/builtin.agent-support/index";
import { trixty } from "@/api/trixty";

interface AgentFileInfo {
  name: string;
  path: string;
  content: string;
  isCore?: boolean;
}

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
  
  aggregatedPrompt: string;
  chatMode: 'agent' | 'planer' | 'ask';
  setChatMode: (mode: 'agent' | 'planer' | 'ask') => void;
  getSystemPrompt: () => string;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { rootPath } = useApp();
  
  const [agents, setAgents] = useState("");
  const [userContext, setUserContext] = useState("");
  const [tools, setTools] = useState("");
  const [memory, setMemory] = useState("");
  const [design, setDesign] = useState("");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [activeDocs, setActiveDocs] = useState<string[]>([]);
  const [chatMode, _setChatMode] = useState<'agent' | 'planer' | 'ask'>('agent');
  const [isLoading, setIsLoading] = useState(false);

  const loadFile = useCallback(async (name: string) => {
    if (!rootPath) return "";
    const path = `${rootPath}/.agents/${name}`;
    try {
      return await invoke("read_file", { path }, { silent: true });
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
      return [];
    }
  }, [rootPath]);

  const setChatMode = useCallback((mode: 'agent' | 'planer' | 'ask') => {
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
      console.error("[AgentContext] Failed to save project settings:", e);
    }
  }, [rootPath]);

  const loadProjectSettings = useCallback(async () => {
    if (!rootPath) return { activeSkills: [], activeDocs: [] };
    const path = `${rootPath}/.agents/settings.json`;
    try {
      const content = await invoke("read_file", { path }, { silent: true });
      return JSON.parse(content);
    } catch (e) {
      return { activeSkills: [], activeDocs: [] };
    }
  }, [rootPath]);

  const refreshAgentData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { trixtyStore } = await import("@/api/store");
      const globalUserContent = await trixtyStore.get<string>("trixty-agent-user-context", "");
      setUserContext(globalUserContent);

      const savedMode = await trixtyStore.get<'agent' | 'planer' | 'ask'>("trixty-chat-mode", "agent");
      _setChatMode(savedMode);

      if (!rootPath) {
        setAgents("");
        setTools("");
        setMemory("");
        setSkills([]);
        return;
      }

      // Check if .agents directory exists first to avoid noisy console errors from safeInvoke
      try {
        await invoke("read_directory", { path: `${rootPath}/.agents` }, { silent: true });
      } catch (e) {
        // .agents folder likely doesn't exist, clear local project state and exit
        setAgents("");
        setTools("");
        setMemory("");
        setSkills([]);
        return;
      }

      const [agentsContent, toolsContent, memoryContent, designContent, discoveredSkills, discoveredDocs] = await Promise.all([
        loadFile("AGENTS.md"),
        loadFile("TOOLS.md"),
        loadFile("MEMORY.md"),
        loadFile("DESIGN.md"),
        loadSkills(),
        loadDocs()
      ]);
      
      setAgents(agentsContent);
      setTools(toolsContent);
      setMemory(memoryContent);
      setDesign(designContent);
      setSkills(discoveredSkills);
      setDocs(discoveredDocs);

      // Restore active states from project settings
      const settings = await loadProjectSettings();
      
      // Update local state (filtering out IDs that might no longer exist)
      const validSkills = settings.activeSkills.filter((id: string) => discoveredSkills.some(s => s.id === id));
      const validDocs = settings.activeDocs.filter((id: string) => discoveredDocs.some(d => d.id === id));
      
      setActiveSkills(validSkills);
      setActiveDocs(validDocs);
      
      // Sync registry
      validSkills.forEach((id: string) => trixty.agent.registerSkill(id));
      validDocs.forEach((id: string) => trixty.agent.registerDoc(id));
    } catch (err) {
      console.error("[AgentContext] Error refreshing agent data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [rootPath, loadFile, loadSkills]);

  // Lock modes if no rootPath
  useEffect(() => {
    if (!rootPath && (chatMode === 'agent' || chatMode === 'planer')) {
      setChatMode('ask');
    }
  }, [rootPath, chatMode, setChatMode]);

  useEffect(() => {
    refreshAgentData();
  }, [rootPath, refreshAgentData]);

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
      console.error(`[AgentContext] Error saving ${fileName}:`, err);
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
  }, [agents, userContext, tools, memory, skills, activeSkills]);

  const getSystemPrompt = useCallback(() => {
    const base = aggregatedPrompt;
    
    if (chatMode === 'planer') {
      return `${base}
### AGENT MODE: PLANNER (Architect)
- STICKY RULE: You MUST NOT execute any tools. 
- YOUR GOAL: Break down the user's request into a high-level technical plan.
- MEMORY MANAGEMENT: Include specific steps to update ".agents/MEMORY.md" in your plans whenever a structural decision or important change is proposed.
- OUTPUT FORMAT: Use markers like "Implementation Plan" or "TODO List".
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
- WORKFLOW: Synchronize with project files, execute commands, and fulfill the requested changes.
- COMPLEXITY RULE: If a task seems too large or architectural, suggest switching to Planner mode before executing.`;
  }, [aggregatedPrompt, chatMode]);

  return (
    <AgentContext.Provider value={{
      identity: CORE_IDENTITY,
      soul: CORE_SOUL,
      agents,
      userContext,
      tools,
      memory,
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
      aggregatedPrompt,
      chatMode,
      setChatMode,
      getSystemPrompt
    }}>
      {children}
    </AgentContext.Provider>
  );
};

export const useAgent = () => {
  const context = useContext(AgentContext);
  if (!context) throw new Error("useAgent must be used within an AgentProvider");
  return context;
};
