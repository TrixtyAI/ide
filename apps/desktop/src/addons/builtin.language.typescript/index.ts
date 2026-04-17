export const activate = (trixty: typeof import("@/api/trixty").trixty) => {
  console.log("[builtin.language.typescript] Activating...");

  // Register TypeScript/JavaScript languages
  trixty.languages.register({
    id: "typescript",
    extensions: [".ts", ".tsx"],
    aliases: ["TypeScript", "ts", "typescript"],
    mimetypes: ["text/typescript"]
  });

  trixty.languages.register({
    id: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    aliases: ["JavaScript", "js", "javascript"],
    mimetypes: ["text/javascript"]
  });

  // Configure indentation for JS/TS
  trixty.languages.setIndentation("typescript", { tabSize: 2, insertSpaces: true });
  trixty.languages.setIndentation("javascript", { tabSize: 2, insertSpaces: true });
};
