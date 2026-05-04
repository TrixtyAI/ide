"use client";

import { motion } from "framer-motion";
import { 
  Bot, 
  Terminal, 
  Layers, 
  Share2, 
  ShieldCheck, 
  Blocks,
  Search,
  Monitor
} from "lucide-react";
import React from "react";

interface Feature {
  title: string;
  description: string;
  icon: React.ElementType;
}

const features: Feature[] = [
  {
    title: "Multi-Agent Orchestration",
    description: "Assign complex tasks to specialized AI agents that plan, write code, and run tests autonomously.",
    icon: Bot,
  },
  {
    title: "Real-time Collaboration",
    description: "P2P pair programming powered by WebRTC and Yjs. Code together with zero latency and full privacy.",
    icon: Share2,
  },
  {
    title: "Integrated Environment",
    description: "Built-in GPU-accelerated terminal, multi-instance support, and an integrated development browser.",
    icon: Terminal,
  },
  {
    title: "Extension Marketplace",
    description: "Compatible with VS Code extensions and MCP servers to expand your development capabilities.",
    icon: Blocks,
  },
  {
    title: "Zen Mode & Focus",
    description: "High-contrast, distraction-free interface designed for deep work and maximum productivity.",
    icon: Monitor,
  },
  {
    title: "Advanced Search",
    description: "Deep codebase analysis and semantic search powered by local or cloud-hosted LLMs.",
    icon: Search,
  },
];

export function Features() {
  return (
    <section id="features" className="py-32 bg-black relative">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-24 flex flex-col items-center text-center">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="text-4xl md:text-6xl font-bold tracking-tighter mb-6"
          >
            Built for the modern <br />
            <span className="text-gray-500">engineer</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            viewport={{ once: true }}
            className="text-gray-500 text-lg max-w-2xl font-medium"
          >
            A powerful suite of tools designed to optimize your workflow 
            and leverage the full potential of agentic AI.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1px bg-white/5 border border-white/5">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ duration: 1, delay: index * 0.1 }}
              viewport={{ once: true }}
              className="p-12 bg-black hover:bg-white/[0.02] transition-colors group"
            >
              <div className="w-10 h-10 text-white mb-8 group-hover:scale-110 transition-transform">
                <feature.icon size={28} strokeWidth={1.5} />
              </div>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] mb-4">{feature.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed font-medium">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
