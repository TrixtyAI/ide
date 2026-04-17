// language example
export const activate = (ctx) => {
  const languageId = "trixty-meta";

  // 1. Register the language
  ctx.languages.register({
    id: languageId,
    extensions: [".txm", ".trixty"],
    aliases: ["Trixty Meta", "txm"],
  });

  // 2. Define Monarch tokens (The part the user specifically linked to)
  ctx.languages.setMonarchTokens(languageId, {
    tokenizer: {
      root: [
        [/\b[A-Z][\w$]*/, "type.identifier"], // PascalCase keywords
        [/\b(addon|register|activate|deactivate)\b/, "keyword"],
        [/@[\w]+/, "annotation"],
        [/"[^"]*"/, "string"],
        [/\/\/.*/, "comment"],
        [/\{|\}/, "delimiter.bracket"],
      ]
    }
  });

  // 3. Define Language Configuration
  ctx.languages.setConfiguration(languageId, {
    comments: {
      lineComment: "//",
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
  });

  // 4. Set indentation
  ctx.languages.setIndentation(languageId, { tabSize: 2, insertSpaces: true });
};
