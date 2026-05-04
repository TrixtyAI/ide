"use client";

import Link from "next/link";
import Image from "next/image";
import { Star, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export function Navbar() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    fetch("https://api.github.com/repos/TrixtyAI/ide")
      .then((res) => res.json())
      .then((data) => {
        if (data.stargazers_count) setStars(data.stargazers_count);
      })
      .catch(() => { });
  }, []);

  const formattedStars = stars ? (stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars) : null;

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
      className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-black/60 backdrop-blur-md"
    >
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-6 h-6 relative">
              <Image
                src="/logo.png"
                alt="Trixty Logo"
                fill
                priority
                loading="eager"
                className="object-contain invert opacity-90 group-hover:opacity-100 transition-opacity"
              />
            </div>
            <span className="font-bold tracking-[0.2em] text-sm uppercase">TRIXTY</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <NavLink href="#features">Features</NavLink>
            <NavLink target="_blank" href="https://github.com/TrixtyAI/ide/blob/dev/CHANGELOG.md">Changelog</NavLink>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <a
            href="https://github.com/TrixtyAI/ide"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-3 py-1.5 border border-white/10 bg-white/5 text-white font-bold text-[10px] uppercase tracking-wider rounded-sm hover:bg-white hover:text-black transition-all active:scale-95"
          >
            <Star size={12} className="fill-white group-hover:fill-black" />
            {formattedStars && (
              <span className=" text-gray-400 group-hover:text-black/60">
                {formattedStars}
              </span>
            )}
            <span>Stars</span>
          </a>
        </div>
      </div>
    </motion.nav>
  );
}

function NavLink({ href, children, target }: { href: string; children: React.ReactNode; target?: string }) {
  return (
    <Link
      href={href}
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      className="text-[11px] uppercase tracking-[0.1em] font-bold text-gray-500 hover:text-white transition-colors"
    >
      {children}
    </Link>
  );
}
