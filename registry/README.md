<div align="center">
  <img src="../resourses/trixty-white.png" alt="Trixty Logo" width="60" />
  <h1>Trixty Extension Registry</h1>
  <p><strong>The official marketplace configuration for the Trixty IDE.</strong></p>
</div>

---

## 🛠️ Purpose

This directory serves as the **Decentralized Registry** for Trixty Extensions. Instead of hosting extension binary blobs, Trixty uses a source-based registration system. This allows developers to host their addons anywhere on Git while still being discoverable by the community.

## 📂 Structure

- **`marketplace.json`**: The core catalog file. It contains a list of extension definitions including their unique ID, repository URL, and target branch/path.

## 🧩 How it Works

When Trixty IDE loads, it queries this registry (or a remote mirror of it) to:
1.  Discover available extensions in the marketplace.
2.  Provide installation links that clone/fetch the addon source directly into the user's workspace.
3.  Manage versions and updates based on Git tags or branches.

## 🚀 Contributing an Extension

To register your extension in the official marketplace, follow these steps:

1.  **Publish your addon**: Ensure your extension is in a public Git repository.
2.  **Edit `marketplace.json`**: Add a new entry to the `marketplace` array:
    ```json
    {
      "id": "your.extension.id",
      "repository": "https://github.com/username/repository.git",
      "branch": "main",
      "path": "subdirectory/if/applicable"
    }
    ```
3.  **Submit a Pull Request**: Submit your changes to the Trixty IDE repository.

---

<div align="center">
  <i>Part of the Trixty IDE Ecosystem</i>
</div>
