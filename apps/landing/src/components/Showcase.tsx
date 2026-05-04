"use client";

import { motion } from "framer-motion";
import Image from "next/image";

export function Showcase() {
  return (
    <section className="py-24 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 40 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
          viewport={{ once: true }}
          className="relative rounded-sm border border-white/10 bg-black overflow-hidden shadow-[0_50px_100px_-30px_rgba(255,255,255,0.05)]"
        >

          {/* Main Image with Scale Effect */}
          <div className="relative aspect-video group overflow-hidden">
            <Image
              src="/showcase.png"
              alt="Trixty IDE Interface"
              fill
              priority
              loading="eager"
              className="object-cover transition-transform duration-1000"
            />
            {/* Overlay Gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60" />
          </div>
        </motion.div>
      </div>

      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-radial from-white/[0.03] to-transparent -z-10 blur-3xl pointer-events-none" />
    </section>
  );
}
