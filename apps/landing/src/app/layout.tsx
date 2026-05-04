import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trixty | A new Open Source Agentic IDE",
  description: "A modern, agentic, and highly extensible development environment built for the next generation of developers powered by Rust, and designed for pure focus.",
  keywords: ["IDE", "AI", "Agents", "Open Source", "Agentic IDE", "Software Development", "Automation", "Rust", "Multi-agent"],
  authors: [{ name: "Trixty AI" }],
  openGraph: {
    title: "Trixty | A new Open Source Agentic IDE",
    description: "A modern, agentic, and highly extensible development environment built for the next generation of developers powered by Rust, and designed for pure focus.",
    url: "https://trixty.vercel.app",
    siteName: "Trixty",
    images: [
      {
        url: "/showcase.png",
        width: 1200,
        height: 630,
        alt: "Trixty IDE Preview",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Trixty | A new Open Source Agentic IDE",
    description: "A modern, agentic, and highly extensible development environment built for the next generation of developers powered by Rust, and designed for pure focus.",
    images: ["/showcase.png"],
    creator: "@trixtyapp",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <Script
          defer
          src={process.env.NEXT_PUBLIC_UMAMI_URL}
          data-website-id={process.env.NEXT_PUBLIC_UMAMI_ID}
        />
      </head>
      <body className="min-h-full flex flex-col bg-black text-white">{children}</body>
    </html>
  );
}
