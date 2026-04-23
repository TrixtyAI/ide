import { describe, expect, it } from "vitest";
import { parseStreamChunk } from "./ollamaStream";

describe("parseStreamChunk", () => {
  it("parses a single complete NDJSON line", () => {
    const { lines, remainder } = parseStreamChunk("", '{"a":1}\n');
    expect(remainder).toBe("");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ kind: "json", value: { a: 1 } });
  });

  it("parses two complete lines in one chunk", () => {
    const { lines, remainder } = parseStreamChunk("", '{"a":1}\n{"b":2}\n');
    expect(remainder).toBe("");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.kind === "json" && l.value)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("holds a mid-line split in the remainder until the next chunk arrives", () => {
    // Simulates reqwest cutting mid-object across two bytes_stream chunks.
    const first = parseStreamChunk("", '{"a":');
    expect(first.lines).toHaveLength(0);
    expect(first.remainder).toBe('{"a":');

    const second = parseStreamChunk(first.remainder, '1}\n');
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]).toEqual({ kind: "json", value: { a: 1 } });
    expect(second.remainder).toBe("");
  });

  it("skips a malformed line but parses surrounding valid lines", () => {
    const chunk = '{"a":1}\nnot-json\n{"b":2}\n';
    const { lines, remainder } = parseStreamChunk("", chunk);
    expect(remainder).toBe("");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ kind: "json", value: { a: 1 } });
    expect(lines[1].kind).toBe("error");
    // Sanity: the raw text of the bad line is preserved so logs can name it.
    if (lines[1].kind === "error") {
      expect(lines[1].raw).toBe("not-json");
    }
    expect(lines[2]).toEqual({ kind: "json", value: { b: 2 } });
  });

  it("tolerates CRLF line endings from Windows Ollama builds", () => {
    const chunk = '{"a":1}\r\n{"b":2}\r\n';
    const { lines, remainder } = parseStreamChunk("", chunk);
    expect(remainder).toBe("");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ kind: "json", value: { a: 1 } });
    expect(lines[1]).toEqual({ kind: "json", value: { b: 2 } });
  });

  it("carries the tail when a chunk does not end on a newline", () => {
    // First chunk ends mid-line; buffer is passed into the next call.
    const first = parseStreamChunk("", '{"a":1}\n{"b":');
    expect(first.lines).toHaveLength(1);
    expect(first.remainder).toBe('{"b":');

    const second = parseStreamChunk(first.remainder, '2}\n');
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]).toEqual({ kind: "json", value: { b: 2 } });
    expect(second.remainder).toBe("");
  });

  it("is a no-op on an empty chunk", () => {
    const { lines, remainder } = parseStreamChunk("", "");
    expect(lines).toHaveLength(0);
    expect(remainder).toBe("");
  });

  it("drops blank lines between payloads without surfacing a parse error", () => {
    const { lines, remainder } = parseStreamChunk("", '{"a":1}\n\n{"b":2}\n');
    expect(remainder).toBe("");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ kind: "json", value: { a: 1 } });
    expect(lines[1]).toEqual({ kind: "json", value: { b: 2 } });
  });
});
