import { defineConfig } from "vitest/config";
import path from "node:path";

// Minimal vitest config for the desktop app's pure-TS unit tests.
// Component / DOM tests would need `environment: "jsdom"` + the React Testing
// Library setup; the first wave of tests covers utility modules only, so the
// default node environment is sufficient and keeps CI cheap.
export default defineConfig({
  resolve: {
    // Mirror the `@/*` -> `./src/*` alias from tsconfig.json so imports in
    // tests match the app code they exercise.
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Leave `.next/`, `node_modules/`, and `src-tauri/` out of the scan so a
    // stale build artifact never shadows real source.
    exclude: ["node_modules/**", ".next/**", "src-tauri/**"],
  },
});
