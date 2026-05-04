"use client";

import { motion } from "framer-motion";
import { Code2, Apple, Monitor, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

export function Hero() {
  const [os, setOs] = useState<"Windows" | "macOS" | "Linux">("Windows");
  const [downloadUrl, setDownloadUrl] = useState("https://github.com/TrixtyAI/ide/releases/latest");

  useEffect(() => {
    const detectOS = () => {
      const ua = window.navigator.userAgent;
      if (ua.indexOf("Win") !== -1) return "Windows";
      if (ua.indexOf("Mac") !== -1) return "macOS";
      if (ua.indexOf("Linux") !== -1) return "Linux";
      return "Windows";
    };
    const detected = detectOS();
    const timer = setTimeout(() => setOs(detected), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    fetch("https://api.github.com/repos/TrixtyAI/ide/releases/latest")
      .then((res) => res.json())
      .then((data) => {
        interface GithubAsset {
          name: string;
          browser_download_url: string;
        }
        const assets = (data.assets || []) as GithubAsset[];
        let url = "";
        if (os === "Windows") {
          url = assets.find((a) => a.name.endsWith(".exe") || a.name.endsWith(".msi"))?.browser_download_url || "";
        } else if (os === "macOS") {
          url = assets.find((a) => a.name.endsWith(".dmg") || a.name.endsWith(".zip"))?.browser_download_url || "";
        } else if (os === "Linux") {
          url = assets.find((a) => a.name.endsWith(".AppImage") || a.name.endsWith(".deb"))?.browser_download_url || "";
        }
        if (url) setDownloadUrl(url);
      })
      .catch(() => {});
  }, [os]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }
    },
  };

  const getOSIcon = () => {
    switch (os) {
      case "macOS": return <Apple size={24} />;
      case "Linux": return <Terminal size={24} />;
      default: return <Monitor size={24} />;
    }
  };

  return (
    <section id="hero" className="relative pt-40 pb-24 overflow-hidden min-h-[90vh] flex items-center">
      <div className="max-w-7xl mx-auto px-6 relative z-10 w-full">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center text-center"
        >

          <motion.h1
            variants={itemVariants}
            className="text-6xl md:text-8xl lg:text-[10rem] font-black tracking-[-0.05em] leading-[0.8] mb-12 max-w-6xl"
          >
            <span className="text-2xl md:text-3xl lg:text-4xl block mb-6 tracking-normal font-medium text-gray-500">A new</span>
            <span className="text-white">Open Source</span> <br />
            <span className="text-gray-600">Agentic IDE</span>
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="text-lg text-gray-500 mb-14 max-w-xl leading-relaxed font-medium"
          >
            A modern, agentic, and highly extensible development environment built for the next generation of developers powered by Rust, and designed for pure focus.
          </motion.p>

          {/* Download Section (OS Aware) */}
          <motion.div
            variants={itemVariants}
            className="flex flex-col items-center gap-8"
          >
            <div className="flex items-stretch shadow-[0_30px_60px_rgba(255,255,255,0.1)]">
              <a
                href={downloadUrl}
                className="px-12 py-5 bg-white text-black font-black text-xs uppercase tracking-[0.2em] rounded-sm flex items-center gap-4 hover:bg-gray-100 transition-all active:scale-[0.98]"
              >
                {getOSIcon()}
                <span>Download for {os}</span>
              </a>
            </div>

            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-6 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
                <a
                  href="https://github.com/TrixtyAI"
                  target="_blank"
                  className="hover:text-white transition-colors flex items-center gap-2"
                >
                  <Code2 size={12} />
                  View on GitHub
                </a>
              </div>

              <p className="text-[10px] text-gray-600 uppercase tracking-widest">
                By using Trixty IDE, you agree to its <a href="#" className="text-gray-400 hover:text-white transition-colors underline underline-offset-4">license</a>.
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Dynamic Background Elements */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-white/[0.02] blur-[150px] rounded-full -z-10 pointer-events-none animate-pulse" />
      <div className="grid-overlay" />
    </section>
  );
}
