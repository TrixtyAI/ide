import { trixty } from "@/api/trixty";

export const activate = (trixty: typeof import("@/api/trixty").trixty) => {
  console.log("[builtin.language.python] Activating...");

  trixty.languages.register({
    id: "python",
    extensions: [".py", ".pyw", ".pyi"],
    aliases: ["Python", "py"],
  });

  // Python standard is 4 spaces
  trixty.languages.setIndentation("python", { tabSize: 4, insertSpaces: true });
};
