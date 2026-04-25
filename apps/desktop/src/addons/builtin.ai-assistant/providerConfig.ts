import { Sparkles, Globe } from "lucide-react";

export interface ProviderMeta {
  id: 'gemini' | 'openrouter';
  name: string;
  color: string;       // badge/accent color
  placeholder: string; // model ID example hint
  icon: React.ElementType;
}

export const PROVIDERS: Record<string, ProviderMeta> = {
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    color: '#4285F4',
    placeholder: 'e.g. gemini-2.0-flash',
    icon: Sparkles,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    color: '#FF6B35',
    placeholder: 'e.g. anthropic/claude-3.5-sonnet',
    icon: Globe,
  },
};
