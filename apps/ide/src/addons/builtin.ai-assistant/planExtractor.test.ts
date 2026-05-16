import { describe, expect, it } from "vitest";
import { extractPlan } from "./planExtractor";

describe("extractPlan", () => {
  it("extracts the body of a standard ```plan fence", () => {
    const input = [
      "Here is the plan.",
      "",
      "```plan",
      "- [ ] Step 1",
      "- [ ] Step 2",
      "```",
      "",
      "Ready when you are.",
    ].join("\n");
    expect(extractPlan(input)).toBe("- [ ] Step 1\n- [ ] Step 2");
  });

  it("accepts the tilde fence variant", () => {
    const input = "~~~plan\n- [ ] do thing\n~~~";
    expect(extractPlan(input)).toBe("- [ ] do thing");
  });

  it("tolerates a trailing language tag after `plan`", () => {
    const input = "```plan markdown\n- step\n```";
    expect(extractPlan(input)).toBe("- step");
  });

  it("returns null when no fenced plan block is present", () => {
    expect(extractPlan("No plan here, just prose.")).toBeNull();
    expect(extractPlan("")).toBeNull();
  });

  it("returns null for an empty plan body", () => {
    expect(extractPlan("```plan\n\n```")).toBeNull();
  });

  it("prefers the first plan block when multiple exist", () => {
    const input = "```plan\nfirst\n```\n\nmore prose\n\n```plan\nsecond\n```";
    expect(extractPlan(input)).toBe("first");
  });
});
