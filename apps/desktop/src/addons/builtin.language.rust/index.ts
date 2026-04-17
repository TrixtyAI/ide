import { trixty } from "@/api/trixty";

export const activate = (trixty: typeof import("@/api/trixty").trixty) => {
  trixty.languages.register({
    id: "rust",
    extensions: [".rs"],
    aliases: ["Rust", "rust"],
  });
  
  trixty.languages.setIndentation("rust", { tabSize: 4, insertSpaces: true });
};
