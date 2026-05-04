"use client";

import Link from "next/link";

export function Footer() {
  return (
    <footer className="py-24 border-t border-white/5 bg-black relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-16 mb-24">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="font-bold tracking-[0.3em] text-sm uppercase mb-8 block">
              TRIXTY
            </Link>
            <p className="text-gray-500 max-w-sm text-sm leading-relaxed font-medium">
              A modern, agentic, and highly extensible development environment built for the next generation of developers powered by Rust, and designed for pure focus.
            </p>
          </div>


        </div>

        <div className="flex flex-col md:flex-row items-center justify-between pt-12 border-t border-white/5 gap-8">
          <p className="text-gray-600 text-[10px] font-bold uppercase tracking-widest">
            © {new Date().getFullYear()} Trixty AI Labs.
          </p>

        </div>
      </div>

      {/* Decorative Binary Background for Footer */}
      <div className="absolute bottom-0 right-0 opacity-[0.02] text-[8px] font-mono select-none pointer-events-none rotate-12 translate-x-1/4 translate-y-1/4 whitespace-pre leading-none">
        {Array.from({ length: 40 }).map((_, i) => (
          <div key={i}>{"01".repeat(50)}</div>
        ))}
      </div>
    </footer>
  );
}

