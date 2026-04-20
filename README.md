<div align="center">
  <img src="resourses/trixty-white.png" alt="Trixty Logo" width="120" />
  <h1>Trixty IDE</h1>
  <p><strong>A modern, agentic, and highly extensible IDE built for the next generation of developers.</strong></p>

  [![Version](https://img.shields.io/github/package-json/v/TrixtyAI/ide?style=flat-square&color=blue)](https://github.com/TrixtyAI/ide/releases)
  [![License](https://img.shields.io/badge/license-UPL--1.0-green?style=flat-square)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#)
  [![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-orange.svg?style=flat-square)](CONTRIBUTING.md)
</div>

---

## 🚀 Overview

**Trixty IDE** is a lightweight yet powerful Integrated Development Environment designed from the ground up to be **AI-native** and **extensible**. Built using a high-performance Rust core and a modern web-based frontend, Trixty offers a development experience that balances speed, aesthetics, and intelligence.

### ✨ Key Features

- 🧠 **AI-Native Coding**: Seamlessly integrated AI assistant right at your fingertips to help with debugging, refactoring, and code generation.
- 🧩 **Pluggable Architecture**: Extend your IDE with the **Trixty SDK**. Register custom languages, UI components, and commands dynamically.
- 🎨 **Minimalist Design**: A noise-free, premium interface that prioritizes your code and focus.
- 📂 **Git Integration**: Built-in source control explorer to manage your changes effortlessly.
- 🌍 **L10n Ready**: Multi-language support out of the box (English, Spanish, and more).

---

## 🛠️ Technical Stack

Trixty leverages the latest technologies to ensure a smooth and robust development experience:

- **Core Engine**: [Rust](https://www.rust-lang.org/) & [Tauri](https://tauri.app/) (Native performance & security).
- **Frontend Architecture**: [Next.js](https://nextjs.org/) (React) + [TypeScript](https://www.typescriptlang.org/).
- **Editor Core**: [Monaco Editor](https://microsoft.github.io/monaco-editor/) (The engine behind VS Code).
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) for a modern, responsive UI.
- **Addon System**: Custom sandbox environment for dynamic extension loading.

---

## 📦 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v24+)
- [pnpm](https://pnpm.io/) (v9.15+)
- [Rust & Cargo](https://www.rust-lang.org/tools/install) (for desktop builds)
- [Ollama](https://ollama.com/) (required for AI features)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/TrixtyAI/ide.git
   cd trixty-ide
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Run the desktop app (Development mode):**
   ```bash
   pnpm desktop
   ```

---

## 🧩 Extensions & Registry

Trixty features a decentralized extension system. You can explore or contribute to the official registry in the [`registry/`](registry/) directory.

Addons can contribute:
- **Languages**: Custom syntax highlighting and configurations.
- **UI Views**: New panels in the activity bar or sidebar.
- **Commands**: New actions accessible via the command palette.

---

## 🤝 Contributing

We love contributions! Whether you're fixing a bug, improving documentation, or adding a new feature, your help is welcome.

Before you start, please read our [Contributing Guide](CONTRIBUTING.md) to learn about our development process, coding standards, and legal requirements.

### 💖 Community

Join our growing community to stay updated and get support:
- [GitHub Discussions](https://github.com/TrixtyAI/ide/discussions) — Ask questions and share ideas.
- [Issue Tracker](https://github.com/TrixtyAI/ide/issues) — Report bugs or request features.

---

## 👥 Contributors

A huge thank you to everyone who has contributed to Trixty IDE!

<a href="https://github.com/TrixtyAI/ide/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=TrixtyAI/ide" />
</a>

---

## ⚖️ License

This project is licensed under the **UnSetSoft Public License (UPL) 1.0**. See the [LICENSE](LICENSE) file for details.

---

<div align="center">
  Made with ❤️ by <b>jmaxdev</b> and the Trixty Community
</div>
