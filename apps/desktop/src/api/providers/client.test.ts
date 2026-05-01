import { describe, expect, it } from "vitest";
import { extractStreamDelta, extractFullResponse } from "./client";

describe("extractStreamDelta", () => {
  it("returns empty string for the [DONE] sentinel and non-JSON input", () => {
    for (const provider of ["openai", "anthropic", "gemini", "openrouter"] as const) {
      expect(extractStreamDelta(provider, "[DONE]")).toBe("");
      expect(extractStreamDelta(provider, "")).toBe("");
      expect(extractStreamDelta(provider, "not-json")).toBe("");
    }
  });

  it("extracts choices[0].delta.content for OpenAI / OpenRouter", () => {
    const data = JSON.stringify({
      choices: [{ delta: { content: "hello" } }],
    });
    expect(extractStreamDelta("openai", data)).toBe("hello");
    expect(extractStreamDelta("openrouter", data)).toBe("hello");
  });

  it("returns empty for OpenAI events without delta.content (role-only chunks)", () => {
    const roleOnly = JSON.stringify({
      choices: [{ delta: { role: "assistant" } }],
    });
    expect(extractStreamDelta("openai", roleOnly)).toBe("");
  });

  it("extracts content_block_delta.text_delta for Anthropic", () => {
    const data = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "world" },
    });
    expect(extractStreamDelta("anthropic", data)).toBe("world");
  });

  it("ignores Anthropic housekeeping events (message_start, ping, message_stop)", () => {
    expect(
      extractStreamDelta("anthropic", JSON.stringify({ type: "ping" })),
    ).toBe("");
    expect(
      extractStreamDelta("anthropic", JSON.stringify({ type: "message_start" })),
    ).toBe("");
    expect(
      extractStreamDelta("anthropic", JSON.stringify({ type: "message_stop" })),
    ).toBe("");
  });

  it("ignores Anthropic content_block_delta with non-text_delta variants", () => {
    // Future-proof: tool_use deltas show up under content_block_delta too
    // and must NOT be appended as if they were chat text.
    const toolUse = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: "{...}" },
    });
    expect(extractStreamDelta("anthropic", toolUse)).toBe("");
  });

  it("extracts candidates[0].content.parts[*].text for Gemini", () => {
    const data = JSON.stringify({
      candidates: [
        { content: { parts: [{ text: "foo" }, { text: " bar" }] } },
      ],
    });
    expect(extractStreamDelta("gemini", data)).toBe("foo bar");
  });

  it("returns empty for Gemini events without text parts", () => {
    expect(
      extractStreamDelta(
        "gemini",
        JSON.stringify({ candidates: [{ finishReason: "STOP" }] }),
      ),
    ).toBe("");
  });
});

describe("extractFullResponse", () => {
  it("extracts choices[0].message.content for OpenAI / OpenRouter", () => {
    const body = JSON.stringify({
      choices: [{ message: { content: "complete reply" } }],
    });
    expect(extractFullResponse("openai", body)).toBe("complete reply");
    expect(extractFullResponse("openrouter", body)).toBe("complete reply");
  });

  it("joins all content[*].text blocks for Anthropic, ignoring tool_use", () => {
    const body = JSON.stringify({
      content: [
        { type: "text", text: "alpha " },
        { type: "tool_use", id: "x", name: "y", input: {} },
        { type: "text", text: "beta" },
      ],
    });
    expect(extractFullResponse("anthropic", body)).toBe("alpha beta");
  });

  it("joins all candidates[*].content.parts[*].text blocks for Gemini", () => {
    const body = JSON.stringify({
      candidates: [
        { content: { parts: [{ text: "one " }, { text: "two" }] } },
        { content: { parts: [{ text: " three" }] } },
      ],
    });
    expect(extractFullResponse("gemini", body)).toBe("one two three");
  });

  it("returns empty string for non-JSON or empty bodies", () => {
    for (const provider of ["openai", "anthropic", "gemini", "openrouter"] as const) {
      expect(extractFullResponse(provider, "")).toBe("");
      expect(extractFullResponse(provider, "garbage")).toBe("");
    }
  });
});
