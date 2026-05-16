import { describe, expect, it } from "vitest";
import {
  classifyToolError,
  failureKey,
  formatToolError,
} from "./toolErrors";

describe("classifyToolError", () => {
  it("classifies POSIX ENOENT wording as FILE_NOT_FOUND", () => {
    const err = new Error("read_file failed: No such file or directory (os error 2)");
    const out = classifyToolError(err, "read_file", { path: "missing.ts" });
    expect(out.code).toBe("FILE_NOT_FOUND");
    expect(out.hint).toMatch(/list_directory/);
  });

  it("classifies Rust 'NotFound' variants as FILE_NOT_FOUND", () => {
    const err = new Error("NotFound: path does not exist");
    const out = classifyToolError(err, "read_file", { path: "nope" });
    expect(out.code).toBe("FILE_NOT_FOUND");
  });

  it("classifies 'outside the workspace' as PATH_OUTSIDE_WORKSPACE", () => {
    const err = new Error("Path is outside the workspace and cannot be accessed.");
    const out = classifyToolError(err, "write_file", {
      path: "../etc/passwd",
      content: "x",
    });
    expect(out.code).toBe("PATH_OUTSIDE_WORKSPACE");
    expect(out.hint).toMatch(/workspace/i);
  });

  it("classifies 'No workspace is open' as WORKSPACE_NOT_OPEN", () => {
    const err = "No workspace is open. Open a project first.";
    const out = classifyToolError(err, "list_directory", { path: "." });
    expect(out.code).toBe("WORKSPACE_NOT_OPEN");
    expect(out.hint).toMatch(/folder/i);
  });

  it("classifies 'permission denied' as PERMISSION_DENIED", () => {
    const err = new Error("EACCES: permission denied, open '/root/.ssh/id_rsa'");
    const out = classifyToolError(err, "read_file", { path: "/root/.ssh/id_rsa" });
    expect(out.code).toBe("PERMISSION_DENIED");
  });

  it("classifies execute_command failures as COMMAND_FAILED when unmatched", () => {
    const err = new Error("Process exited with status 1: build broke");
    const out = classifyToolError(err, "execute_command", {
      command: "pnpm",
      args: ["build"],
    });
    expect(out.code).toBe("COMMAND_FAILED");
  });

  it("classifies network failures for web_search as NETWORK_ERROR", () => {
    const err = new Error("Failed to fetch https://example.com: ECONNREFUSED");
    const out = classifyToolError(err, "web_search", { query: "x" });
    expect(out.code).toBe("NETWORK_ERROR");
  });

  it("falls back to UNKNOWN for truly unfamiliar errors", () => {
    const err = new Error("Quantum decoherence in the tool dispatcher");
    const out = classifyToolError(err, "list_directory", { path: "." });
    expect(out.code).toBe("UNKNOWN");
    expect(out.message).toContain("Quantum decoherence");
  });

  it("accepts non-Error values without throwing", () => {
    const out = classifyToolError("plain string failure", "read_file", {
      path: "x",
    });
    expect(out.code).toBe("UNKNOWN");
    expect(out.message).toContain("plain string failure");
  });
});

describe("formatToolError", () => {
  it("emits a <tool_error> XML block with code, message, and hint", () => {
    const formatted = formatToolError({
      code: "FILE_NOT_FOUND",
      message: "missing.ts does not exist",
      hint: "Call list_directory first.",
    });
    expect(formatted).toContain('<tool_error code="FILE_NOT_FOUND">');
    expect(formatted).toContain("<message>missing.ts does not exist</message>");
    expect(formatted).toContain("<hint>Call list_directory first.</hint>");
    expect(formatted).toContain("</tool_error>");
  });

  it("omits the hint element when no hint is provided", () => {
    const formatted = formatToolError({
      code: "UNKNOWN",
      message: "boom",
    });
    expect(formatted).toContain("<message>boom</message>");
    expect(formatted).not.toContain("<hint>");
  });

  it("escapes angle brackets and ampersands in message/hint payloads", () => {
    const formatted = formatToolError({
      code: "INVALID_ARGS",
      message: "got <script> & 'quotes'",
      hint: "fix & retry",
    });
    expect(formatted).toContain("&lt;script&gt;");
    expect(formatted).toContain("&amp;");
    expect(formatted).not.toContain("<script>");
  });
});

describe("failureKey", () => {
  it("produces identical keys for identical tool + args", () => {
    const a = failureKey("read_file", { path: "foo.ts" });
    const b = failureKey("read_file", { path: "foo.ts" });
    expect(a).toBe(b);
  });

  it("produces different keys when args differ", () => {
    const a = failureKey("read_file", { path: "foo.ts" });
    const b = failureKey("read_file", { path: "bar.ts" });
    expect(a).not.toBe(b);
  });

  it("produces different keys when tool name differs", () => {
    const a = failureKey("read_file", { path: "foo.ts" });
    const b = failureKey("list_directory", { path: "foo.ts" });
    expect(a).not.toBe(b);
  });
});
