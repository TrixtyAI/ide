import { describe, expect, it } from "vitest";
import { cn } from "./utils";

// `cn()` composes `clsx` for conditional merging and `tailwind-merge` for
// dedupe/override. These tests lock in the contract that component code
// already relies on: falsy values are skipped, duplicates are merged, and
// later Tailwind utilities win over earlier ones of the same category.
describe("cn()", () => {
  it("joins plain string arguments", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("drops falsy values", () => {
    expect(cn("foo", false, null, undefined, "", "bar")).toBe("foo bar");
  });

  it("accepts conditional object syntax", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("accepts nested arrays", () => {
    expect(cn(["foo", ["bar", { baz: true }]])).toBe("foo bar baz");
  });

  it("lets later Tailwind utilities win over earlier ones of the same group", () => {
    // twMerge resolves conflicts: `p-4` replaces `p-2`, `bg-red-500` replaces
    // `bg-blue-500`. This is the reason `cn` exists instead of a plain join.
    expect(cn("p-2 bg-blue-500", "p-4 bg-red-500")).toBe("p-4 bg-red-500");
  });

  it("returns an empty string when given no inputs", () => {
    expect(cn()).toBe("");
  });
});
