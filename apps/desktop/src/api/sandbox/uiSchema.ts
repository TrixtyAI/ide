/**
 * Declarative UI schema traded between the extension worker and the host
 * renderer. Extensions cannot ship React elements or DOM nodes across the
 * Worker boundary — the schema is the *only* way the worker can ask the
 * host to draw something.
 *
 * Every interactive element references a host-generated `handlerId`; when
 * the user triggers that handler the host emits a `host:ui-event` back to
 * the worker, which looks the id up in its own callback table and runs the
 * real function. No executable code crosses the wire in either direction.
 */

/** Elements the sandbox schema understands. Kept intentionally small — the
 * goal is "enough for a useful extension" not "full HTML". Everything else
 * routes through `registerRightPanelView` + a dedicated host-rendered
 * component if a first-party addon needs it. */
export type UiTag =
  | "div"
  | "span"
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "pre"
  | "button"
  | "input"
  | "textarea"
  | "ul"
  | "li"
  | "icon";

/** The subset of props we allow through. We deliberately drop `dangerouslySetInnerHTML`,
 * `style` as arbitrary object, and all `on*` handlers that aren't in this
 * narrow allow-list. The renderer silently ignores unknown keys so a
 * hostile schema can't smuggle, say, `srcDoc` onto an iframe. */
export interface UiProps {
  className?: string;
  id?: string;
  placeholder?: string;
  value?: string | number;
  disabled?: boolean;
  type?: "text" | "password" | "number" | "email";
  "aria-label"?: string;
  role?: string;
  /** Only for `tag: "icon"` — looked up against a host-side `LucideIcons`
   *  map. Unknown names render nothing instead of crashing. */
  iconName?: string;
  iconSize?: number;
  /** Events are opaque IDs. The host turns them into React handlers that
   *  post `host:ui-event` with this id. */
  onClick?: string;
  onChange?: string;
  onInput?: string;
}

export interface UiNode {
  tag: UiTag;
  /** Key for React's reconciler. Optional — renderer falls back to index. */
  key?: string;
  props?: UiProps;
  /** String children render as text nodes; nested `UiNode`s render as
   *  their own React elements. Mixed arrays are supported. */
  children?: Array<UiNode | string | number> | string | number;
}

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

const ALLOWED_TAGS: ReadonlySet<UiTag> = new Set([
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "pre",
  "button",
  "input",
  "textarea",
  "ul",
  "li",
  "icon",
]);

const ALLOWED_PROP_KEYS: ReadonlySet<string> = new Set([
  "className",
  "id",
  "placeholder",
  "value",
  "disabled",
  "type",
  "aria-label",
  "role",
  "iconName",
  "iconSize",
  "onClick",
  "onChange",
  "onInput",
]);

const ALLOWED_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "password",
  "number",
  "email",
]);

/**
 * Walk a UI schema sent from the worker and drop anything that's outside
 * the allow-list. Returns a fresh object so the caller can't accidentally
 * leak a reference back into the worker's scope (the worker sent us a
 * deep-cloned copy anyway, but keeping the invariant explicit is cheap).
 *
 * Invalid nodes become empty `<span>`s rather than throwing, so a single
 * malformed child doesn't take down a whole panel.
 */
export function sanitizeUiNode(node: unknown, depth = 0): UiNode {
  // Defensive depth limit — a hostile extension could try to DoS the host
  // renderer with a deeply nested schema. React itself would stack-overflow
  // first, so cap earlier.
  const FALLBACK: UiNode = { tag: "span" };
  if (depth > 64) return FALLBACK;
  if (!node || typeof node !== "object") return FALLBACK;

  const raw = node as Record<string, unknown>;
  if (typeof raw.tag !== "string" || !ALLOWED_TAGS.has(raw.tag as UiTag)) {
    return FALLBACK;
  }

  const out: UiNode = { tag: raw.tag as UiTag };

  if (typeof raw.key === "string") {
    out.key = raw.key;
  }

  if (raw.props && typeof raw.props === "object") {
    const props: UiProps = {};
    for (const [k, v] of Object.entries(raw.props as Record<string, unknown>)) {
      if (!ALLOWED_PROP_KEYS.has(k)) continue;
      switch (k) {
        case "className":
        case "id":
        case "placeholder":
        case "aria-label":
        case "role":
        case "iconName":
        case "onClick":
        case "onChange":
        case "onInput":
          if (typeof v === "string") {
            (props as Record<string, unknown>)[k] = v;
          }
          break;
        case "value":
          if (typeof v === "string" || typeof v === "number") {
            props.value = v;
          }
          break;
        case "disabled":
          if (typeof v === "boolean") props.disabled = v;
          break;
        case "type":
          if (typeof v === "string" && ALLOWED_INPUT_TYPES.has(v)) {
            props.type = v as UiProps["type"];
          }
          break;
        case "iconSize":
          if (typeof v === "number" && v > 0 && v <= 128) props.iconSize = v;
          break;
      }
    }
    out.props = props;
  }

  if (Array.isArray(raw.children)) {
    out.children = raw.children.map((child) => {
      if (typeof child === "string" || typeof child === "number") return child;
      return sanitizeUiNode(child, depth + 1);
    });
  } else if (typeof raw.children === "string" || typeof raw.children === "number") {
    out.children = raw.children;
  }

  return out;
}
