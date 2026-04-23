// Extracts a fenced ```plan block from a planner-mode assistant message.
//
// The prompt instructs the model to wrap its final plan in a fenced code
// block tagged `plan`. We keep the parser intentionally lenient: local
// models frequently emit `~~~plan`, add language tags like `plan markdown`,
// or include stray whitespace after the tag. We match all of those and
// return the inner body (trimmed), or `null` when no block is present.

const FENCE_PATTERN = /(?:^|\n)(?:```|~~~)plan\b[^\n]*\n([\s\S]*?)(?:\n(?:```|~~~))/;

export function extractPlan(content: string): string | null {
  if (!content) return null;
  const match = FENCE_PATTERN.exec(content);
  if (!match) return null;
  const body = match[1];
  if (!body) return null;
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : null;
}
