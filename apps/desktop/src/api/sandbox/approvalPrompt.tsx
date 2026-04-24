"use client";

/**
 * Imperative wrapper around `ExtensionApprovalModal` that returns a
 * promise resolving to the user's decision. The PluginManager awaits
 * this during external-extension load, so we don't have to reach into
 * `AppContext` or thread a React state update through every caller.
 *
 * Rendering model:
 * - A single overlay root is lazy-attached to `document.body` on first
 *   prompt; subsequent prompts reuse it so we don't churn DOM nodes.
 * - React 18's `createRoot` + `ReactDOM.unmountComponentAtNode` path
 *   keeps this component isolated from the app's normal React tree so
 *   a crash in the modal can't take down the editor.
 * - When Tauri / the webview is not available (unit tests, Node-only
 *   vitest runs), the helper short-circuits and resolves with a
 *   cancelled decision so existing callers don't hang.
 */

import React from "react";
import { createRoot, type Root } from "react-dom/client";
import ExtensionApprovalModal, {
  type ApprovalDecision,
  type ApprovalRequest,
} from "@/components/ExtensionApprovalModal";

const OVERLAY_ID = "trixty-extension-approval-overlay";

let overlayRoot: Root | null = null;
let overlayContainer: HTMLDivElement | null = null;

function ensureOverlay(): Root | null {
  if (typeof document === "undefined") return null;
  if (overlayRoot && overlayContainer && overlayContainer.isConnected) {
    return overlayRoot;
  }
  const container = document.createElement("div");
  container.id = OVERLAY_ID;
  document.body.appendChild(container);
  overlayContainer = container;
  overlayRoot = createRoot(container);
  return overlayRoot;
}

/**
 * Present the approval modal and wait for the user to decide. When no
 * DOM is available (SSR / test runners) this resolves synchronously as
 * `cancelled: true` so callers don't hang.
 */
export function promptForApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    const root = ensureOverlay();
    if (!root) {
      resolve({ approved: [], denied: [], cancelled: true });
      return;
    }
    const handle = (decision: ApprovalDecision) => {
      // Clear the overlay first so React doesn't render the stale
      // modal for a tick while the caller persists the decision.
      root.render(<></>);
      resolve(decision);
    };
    root.render(<ExtensionApprovalModal request={request} onDecide={handle} />);
  });
}
