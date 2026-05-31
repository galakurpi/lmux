import type { AgentDefinition } from "../types";

export const BUILT_IN_AGENTS: AgentDefinition[] = [
  {
    id: "shell",
    name: "Shell",
    description: "Default system shell",
    command: "/bin/bash",
    args: [],
    icon: "$",
    color: "#00ff41",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic AI coding agent",
    command: "/home/gal/Desktop/business/projects/lmux/scripts/lmux-agent",
    args: ["claude"],
    icon: "C",
    color: "#00c853",
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI coding agent",
    command: "/home/gal/Desktop/business/projects/lmux/scripts/lmux-agent",
    args: ["codex"],
    icon: "X",
    color: "#39ff14",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google AI coding agent",
    command: "/home/gal/Desktop/business/projects/lmux/scripts/lmux-agent",
    args: ["gemini"],
    icon: "G",
    color: "#d7ff00",
  },
  {
    id: "aider",
    name: "Aider",
    description: "AI pair programming",
    command: "/home/gal/Desktop/business/projects/lmux/scripts/lmux-agent",
    args: ["aider"],
    icon: "A",
    color: "#00ffaa",
  },
];

export function getAgent(id: string): AgentDefinition | undefined {
  return BUILT_IN_AGENTS.find((a) => a.id === id);
}

export function getDefaultAgent(): AgentDefinition {
  return BUILT_IN_AGENTS[0];
}
