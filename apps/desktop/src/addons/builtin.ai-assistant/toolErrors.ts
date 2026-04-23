// Structured tool-error reporting for the agent loop.
//
// Local models (7B–13B) tend to latch onto structured XML-ish feedback more
// reliably than free-form prose, so rather than handing back a raw
// `"Error executing tool X: ..."` string we classify the failure into a
// short, stable code set and format it as a `<tool_error>` block. The `hint`
// field nudges the model toward a recovery strategy the IDE has already seen
// work ("call list_directory first", "ask the user to open a folder") instead
// of guessing.

export type ToolErrorCode =
  | "FILE_NOT_FOUND"
  | "WORKSPACE_NOT_OPEN"
  | "PATH_OUTSIDE_WORKSPACE"
  | "PERMISSION_DENIED"
  | "INVALID_ARGS"
  | "COMMAND_FAILED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  hint?: string;
}

export type ToolArgs = Record<string, string | number | boolean | string[]>;

// Heuristic classifier. We match on substrings of the raw error message —
// the Rust side surfaces errors as strings and the shape is not guaranteed
// to be stable across OSes (e.g. Windows vs POSIX `ENOENT` text), so the
// matcher leans on the most common English fragments plus a few aliases.
export function classifyToolError(
  err: unknown,
  toolName: string,
  // Currently unused by the classifier but kept in the signature so future
  // heuristics (e.g. inspecting arg shapes for INVALID_ARGS) don't require a
  // call-site change in every invoker.
  args: ToolArgs,
): ToolError {
  void args;
  const rawMessage = err instanceof Error ? err.message : String(err ?? "");
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes("no such file or directory") ||
    lower.includes("notfound") ||
    lower.includes("not found") ||
    lower.includes("cannot find the file") ||
    lower.includes("cannot find the path") ||
    lower.includes("enoent")
  ) {
    return {
      code: "FILE_NOT_FOUND",
      message: rawMessage || `File not found for tool '${toolName}'.`,
      hint: "Call list_directory on the parent path first to discover the correct filename, or use get_workspace_structure for an overview.",
    };
  }

  if (
    lower.includes("no workspace is open") ||
    lower.includes("workspace not open") ||
    lower.includes("no project") ||
    lower.includes("root path is not set")
  ) {
    return {
      code: "WORKSPACE_NOT_OPEN",
      message: rawMessage || "No workspace is open.",
      hint: "Ask the user to open a project folder via the folder icon before trying this tool again.",
    };
  }

  if (
    lower.includes("outside the workspace") ||
    lower.includes("outside workspace") ||
    lower.includes("path traversal") ||
    lower.includes("escape the workspace")
  ) {
    return {
      code: "PATH_OUTSIDE_WORKSPACE",
      message: rawMessage || "Path is outside the workspace.",
      hint: "Use a workspace-relative path. Absolute paths that fall outside the project root are rejected for safety.",
    };
  }

  if (
    lower.includes("permission denied") ||
    lower.includes("access is denied") ||
    lower.includes("eacces") ||
    lower.includes("eperm") ||
    lower.includes("operation not permitted")
  ) {
    return {
      code: "PERMISSION_DENIED",
      message: rawMessage || "Permission denied.",
      hint: "The operating system refused access. Ask the user to verify file permissions or try a different path.",
    };
  }

  if (
    lower.includes("invalid") ||
    lower.includes("missing required") ||
    lower.includes("expected") ||
    lower.includes("malformed")
  ) {
    return {
      code: "INVALID_ARGS",
      message: rawMessage || `Invalid arguments for tool '${toolName}'.`,
      hint: "Review the tool's parameter schema and retry with well-formed arguments.",
    };
  }

  if (toolName === "execute_command") {
    return {
      code: "COMMAND_FAILED",
      message: rawMessage || "Command failed.",
      hint: "Inspect the command output. If it's transient, retry once; if it's an environment issue, surface it to the user.",
    };
  }

  if (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("econnrefused") ||
    lower.includes("dns")
  ) {
    return {
      code: "NETWORK_ERROR",
      message: rawMessage || "Network error.",
      hint: "The request could not reach its destination. If the user enabled an offline profile, stop calling web_search.",
    };
  }

  return {
    code: "UNKNOWN",
    message: rawMessage || `Unknown error from tool '${toolName}'.`,
    hint: "If retrying with the same arguments is unlikely to help, stop and ask the user for guidance.",
  };
}

// XML-ish serialization. We escape only the three characters that would
// otherwise close the block or confuse a naive tokenizer. Local models
// generally pass this through as-is and reference the `code` attribute when
// recovering.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatToolError(err: ToolError): string {
  const hintBlock = err.hint
    ? `\n  <hint>${escapeXml(err.hint)}</hint>`
    : "";
  return `<tool_error code="${err.code}">\n  <message>${escapeXml(err.message)}</message>${hintBlock}\n</tool_error>`;
}

// Stable key for repeat-failure detection. We key on tool name + exact
// arg payload so the loop treats "read_file foo.ts → FILE_NOT_FOUND" and
// "read_file bar.ts → FILE_NOT_FOUND" as distinct attempts; the model only
// gets cut off when it literally retries the same call.
export function failureKey(toolName: string, args: ToolArgs): string {
  try {
    return `${toolName}:${JSON.stringify(args)}`;
  } catch {
    // Circular or un-serializable args are degenerate, but fall through to
    // a weaker key rather than throw.
    return `${toolName}:<unserializable>`;
  }
}
