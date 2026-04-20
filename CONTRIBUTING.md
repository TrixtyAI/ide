# Contributing to Trixty IDE

Welcome, and thank you for your interest in contributing to **Trixty IDE**! 🚀

Trixty is a modern, agentic, and highly extensible IDE built for the next generation of developers. We value your help in making it better, whether you're reporting a bug, suggesting a feature, or contributing code.

---

## ⚖️ Legal Notice (UPL-1.0)

> [!IMPORTANT]
> By contributing to this project, you agree that your contributions will be licensed under the **UnSetSoft Public License (UPL) 1.0**.

Please be aware of the specific conditions of this license:
- **Contributive Purpose**: Modifications are only allowed for the purpose of contributing back to the original project.
- **Non-Commercial**: The software and its derivatives may not be used for commercial purposes.
- **Non-Distribution**: You may not distribute the original software or modified versions externally.
- **Attribution**: Original code must be credited, and the UPL license must be retained in all files.

---

## 🙋 Ways to Contribute

Beyond writing code, there are many ways you can help:

### 💬 Asking Questions
If you have questions about how to use Trixty or how it works, please open a **Discussion** in the [GitHub Discussions](https://github.com/TrixtyAI/ide/discussions) tab. This helps keep our issue tracker clean and makes the answers searchable for others.

### 🐛 Reporting Issues
If you've found a bug or have a feature request:
1. **Search** the existing [Issues](https://github.com/TrixtyAI/ide/issues) to ensure it hasn't been reported yet.
2. **Use the Templates**: We have specific templates for bugs, features, and documentation.
3. **Be Descriptive**:
    - **Bugs**: Include your OS, Trixty version, and clear steps to reproduce.
    - **Features**: Explain the *why* behind your request and how it benefits the community.

---

## 🛠️ Development Workflow

If you're ready to dive into the code, follow these steps:

### 1. Environment Setup
Ensure you have the following installed:
- **Node.js** (v24+) & **pnpm** (v9.15+)
- **Rust** & **Cargo** & **Visual Studio Build Tools** (on Windows)
- **Ollama** (for testing AI features)

### 2. Fork & Clone
1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ide.git
   cd ide
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```

### 3. Create a Branch
Always create a descriptive branch for your work:
```bash
git checkout -b feature/my-cool-feature
# OR
git checkout -b fix/issue-123
```

### 4. Useful Scripts

| Command | What it does |
| --- | --- |
| `pnpm desktop` | Runs the desktop app in development mode (syncs version first) |
| `pnpm build` | Runs the Turborepo build pipeline |
| `pnpm version:sync` | Propagates the root `package.json` version to `Cargo.toml` and `tauri.conf.json` |
| `pnpm --filter @trixty/desktop lint` | Runs ESLint on the frontend |
| `pnpm --filter @trixty/desktop exec tsc --noEmit` | Type-checks the frontend without emitting files |
| `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml` | Runs clippy on the Rust backend |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml` | Formats the Rust backend |

---

## 🚀 Submitting a Pull Request

1. **Verify your changes**: Ensure the app builds (`pnpm desktop`) and behaves as expected.
2. **Push to GitHub**: `git push origin your-branch-name`.
3. **Open a PR**: Fill out the PR template completely.
4. **Be Patient**: The maintainers will review your PR as soon as possible. We may ask for changes or refinements.

---

## ✅ PR Checklist

Before submitting, please ensure:
- [ ] You have searched for existing PRs.
- [ ] Your code follows the project's style and standards.
- [ ] You have verified the change manually (the project does not yet have an automated test suite).
- [ ] Your PR description explains **what** changed and **why**.
- [ ] You agree to the **UPL-1.0** license terms.

---

<p align="center">
  <b>Thank you for helping make Trixty IDE better! ❤️</b>
</p>
