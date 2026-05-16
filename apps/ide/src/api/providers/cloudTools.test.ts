import { describe, expect, it } from "vitest";
import {
  type CanonicalHistoryEntry,
  type ToolDefinition,
  extractToolCallsFromBody,
  translateHistoryForProvider,
  translateToolsForProvider,
} from "./cloudTools";

const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

describe("translateToolsForProvider", () => {
  it("passes OpenAI / OpenRouter tools through unchanged", () => {
    expect(translateToolsForProvider("openai", SAMPLE_TOOLS)).toEqual(SAMPLE_TOOLS);
    expect(translateToolsForProvider("openrouter", SAMPLE_TOOLS)).toEqual(SAMPLE_TOOLS);
  });

  it("flattens the function envelope into the Anthropic shape", () => {
    expect(translateToolsForProvider("anthropic", SAMPLE_TOOLS)).toEqual([
      {
        name: "read_file",
        description: "Read a file",
        input_schema: SAMPLE_TOOLS[0].function.parameters,
      },
    ]);
  });

  it("buckets all declarations under one Gemini outer entry", () => {
    expect(translateToolsForProvider("gemini", SAMPLE_TOOLS)).toEqual([
      {
        functionDeclarations: [
          {
            name: "read_file",
            description: "Read a file",
            parameters: SAMPLE_TOOLS[0].function.parameters,
          },
        ],
      },
    ]);
  });

  it("returns undefined when no tools are provided", () => {
    expect(translateToolsForProvider("openai", undefined)).toBeUndefined();
    expect(translateToolsForProvider("anthropic", [])).toBeUndefined();
  });
});

describe("extractToolCallsFromBody", () => {
  it("reads OpenAI / OpenRouter tool_calls", () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "read_file", arguments: '{"path":"a.ts"}' },
              },
            ],
          },
        },
      ],
    });
    expect(extractToolCallsFromBody("openai", body)).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"a.ts"}' },
      },
    ]);
  });

  it("reads Anthropic tool_use blocks and re-encodes input as JSON", () => {
    const body = JSON.stringify({
      content: [
        { type: "text", text: "Reading file…" },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "read_file",
          input: { path: "a.ts" },
        },
      ],
    });
    expect(extractToolCallsFromBody("anthropic", body)).toEqual([
      {
        id: "toolu_1",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"a.ts"}' },
      },
    ]);
  });

  it("synthesises ids for Gemini functionCall parts", () => {
    const body = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: "read_file", args: { path: "a.ts" } },
              },
            ],
          },
        },
      ],
    });
    const calls = extractToolCallsFromBody("gemini", body);
    expect(calls).toHaveLength(1);
    expect(calls[0].function).toEqual({
      name: "read_file",
      arguments: '{"path":"a.ts"}',
    });
    expect(calls[0].id).toMatch(/^call_/);
  });

  it("returns an empty array for text-only or malformed bodies", () => {
    for (const provider of [
      "openai",
      "anthropic",
      "gemini",
      "openrouter",
    ] as const) {
      expect(extractToolCallsFromBody(provider, "{}")).toEqual([]);
      expect(extractToolCallsFromBody(provider, "")).toEqual([]);
      expect(extractToolCallsFromBody(provider, "garbage")).toEqual([]);
    }
  });
});

describe("translateHistoryForProvider", () => {
  const history: CanonicalHistoryEntry[] = [
    { role: "system", content: "You are a helpful agent." },
    { role: "user", content: "List the workspace." },
    {
      role: "assistant_with_tools",
      content: "",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "list_directory", arguments: '{"path":"."}' },
        },
      ],
    },
    {
      role: "tool_result",
      tool_call_id: "call_1",
      tool_name: "list_directory",
      content: "[\"src\",\"package.json\"]",
    },
    { role: "assistant", content: "Two entries: src and package.json." },
  ];

  it("emits the OpenAI message ladder with system inlined and tool roles", () => {
    const out = translateHistoryForProvider("openai", history);
    expect(out.messages).toEqual([
      { role: "system", content: "You are a helpful agent." },
      { role: "user", content: "List the workspace." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "list_directory", arguments: '{"path":"."}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "[\"src\",\"package.json\"]",
      },
      { role: "assistant", content: "Two entries: src and package.json." },
    ]);
  });

  it("emits the Anthropic shape with system separate and tool blocks", () => {
    const out = translateHistoryForProvider("anthropic", history);
    expect(out.system).toBe("You are a helpful agent.");
    expect(out.messages).toEqual([
      { role: "user", content: "List the workspace." },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "list_directory",
            input: { path: "." },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: "[\"src\",\"package.json\"]",
          },
        ],
      },
      { role: "assistant", content: "Two entries: src and package.json." },
    ]);
  });

  it("emits the Gemini shape with systemInstruction separate", () => {
    const out = translateHistoryForProvider("gemini", history);
    expect(out.systemInstruction).toEqual({
      role: "user",
      parts: [{ text: "You are a helpful agent." }],
    });
    expect(out.contents).toEqual([
      { role: "user", parts: [{ text: "List the workspace." }] },
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "list_directory", args: { path: "." } },
          },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "list_directory",
              response: ["src", "package.json"],
            },
          },
        ],
      },
      {
        role: "model",
        parts: [{ text: "Two entries: src and package.json." }],
      },
    ]);
  });

  it("wraps non-object Gemini tool responses under `result`", () => {
    const out = translateHistoryForProvider("gemini", [
      {
        role: "tool_result",
        tool_call_id: "x",
        tool_name: "echo",
        content: "plain string",
      },
    ]);
    expect(out.contents).toEqual([
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "echo",
              response: { result: "plain string" },
            },
          },
        ],
      },
    ]);
  });
});
