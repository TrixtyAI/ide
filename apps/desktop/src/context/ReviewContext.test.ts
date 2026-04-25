import { describe, expect, it } from "vitest";
import { isReviewerEligible } from "./ReviewContext";

// Pure membership check — no React needed. Kept at the context level so the
// Reviewer panel, the page column, and the AI chat all branch on the same
// single source of truth.
describe("isReviewerEligible", () => {
  it("returns true for destructive tools that benefit from the wide dock", () => {
    expect(isReviewerEligible("write_file")).toBe(true);
    expect(isReviewerEligible("execute_command")).toBe(true);
    expect(isReviewerEligible("remember")).toBe(true);
  });

  it("returns false for read-only tools that stay inline in the AI chat", () => {
    expect(isReviewerEligible("list_directory")).toBe(false);
    expect(isReviewerEligible("read_file")).toBe(false);
    expect(isReviewerEligible("web_search")).toBe(false);
    expect(isReviewerEligible("get_workspace_structure")).toBe(false);
  });

  it("returns false for unknown tool names without throwing", () => {
    expect(isReviewerEligible("")).toBe(false);
    expect(isReviewerEligible("Execute_Command")).toBe(false); // case-sensitive
    expect(isReviewerEligible("nonexistent_tool")).toBe(false);
  });
});
