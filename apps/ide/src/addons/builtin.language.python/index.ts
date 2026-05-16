import { logger } from "@/lib/logger";

export const activate = (trixty: typeof import("@/api/trixty").trixty) => {
  logger.debug("[builtin.language.python] Activating...");

  trixty.languages.register({
    id: "python",
    extensions: [".py", ".pyw", ".pyi"],
    aliases: ["Python", "py"],
  });

  // Python standard is 4 spaces
  trixty.languages.setIndentation("python", { tabSize: 4, insertSpaces: true });
};
