import { describe, expect, it } from "vitest";
import { sanitizeUiNode, type UiNode } from "./uiSchema";

describe("sanitizeUiNode", () => {
  it("returns a fallback span when the input is not a valid tag", () => {
    expect(sanitizeUiNode(null)).toEqual({ tag: "span" });
    expect(sanitizeUiNode(undefined)).toEqual({ tag: "span" });
    expect(sanitizeUiNode("just a string")).toEqual({ tag: "span" });
    expect(sanitizeUiNode({ tag: "script" })).toEqual({ tag: "span" });
    expect(sanitizeUiNode({ tag: "iframe", props: { src: "javascript:alert(1)" } })).toEqual({
      tag: "span",
    });
  });

  it("keeps allow-listed tags and props", () => {
    const input: UiNode = {
      tag: "button",
      props: { className: "btn", onClick: "handler-1", disabled: true },
      children: "Click me",
    };
    const out = sanitizeUiNode(input);
    expect(out.tag).toBe("button");
    expect(out.props).toEqual({
      className: "btn",
      onClick: "handler-1",
      disabled: true,
    });
    expect(out.children).toBe("Click me");
  });

  it("strips unknown props (defence against smuggled attributes)", () => {
    // A hostile extension could try to attach `srcDoc`, `dangerouslySetInnerHTML`,
    // or arbitrary `on*` handlers. None of those are in the allow-list,
    // so the sanitizer must drop them.
    const input = {
      tag: "div",
      props: {
        className: "ok",
        onMouseEnter: "hostile",
        dangerouslySetInnerHTML: { __html: "<img>" },
        srcDoc: "<script>alert(1)</script>",
      },
    };
    const out = sanitizeUiNode(input);
    expect(out.props).toEqual({ className: "ok" });
  });

  it("rejects disallowed input types", () => {
    const out = sanitizeUiNode({
      tag: "input",
      props: { type: "hidden" },
    });
    // `hidden` is not in the allow-list so the prop drops entirely.
    expect(out.props).toEqual({});
  });

  it("preserves string / number children and recursively sanitises nested nodes", () => {
    // The `script` child intentionally violates `UiNode` to mimic a
    // hostile payload — the sanitizer must swap it for a safe fallback.
    const input = {
      tag: "div",
      children: [
        "text",
        42,
        { tag: "span", children: "nested" },
        { tag: "script", children: "bad" },
      ],
    } as unknown as UiNode;
    const out = sanitizeUiNode(input);
    const children = out.children as Array<UiNode | string | number>;
    expect(children[0]).toBe("text");
    expect(children[1]).toBe(42);
    expect((children[2] as UiNode).tag).toBe("span");
    // Dropped down to a span fallback:
    expect((children[3] as UiNode).tag).toBe("span");
  });

  it("caps recursion depth so a hostile schema cannot stack-overflow the renderer", () => {
    let deepest: UiNode = { tag: "span" };
    for (let i = 0; i < 200; i++) {
      deepest = { tag: "div", children: [deepest] };
    }
    // No throw — depth guard kicks in silently.
    const out = sanitizeUiNode(deepest);
    expect(out.tag).toBe("div");
  });

  it("clamps iconSize to a reasonable range", () => {
    const a = sanitizeUiNode({ tag: "icon", props: { iconSize: 12 } });
    expect(a.props?.iconSize).toBe(12);
    const b = sanitizeUiNode({ tag: "icon", props: { iconSize: 99999 } });
    expect(b.props?.iconSize).toBeUndefined();
    const c = sanitizeUiNode({ tag: "icon", props: { iconSize: -4 } });
    expect(c.props?.iconSize).toBeUndefined();
  });
});
