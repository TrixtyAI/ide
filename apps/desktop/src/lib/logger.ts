/**
 * Lightweight leveled logger for Trixty IDE.
 *
 * `debug` calls are elided in production builds so informational logs no longer
 * clutter the DevTools console nor leak user paths and internal state.
 * `warn` and `error` always reach the console so operational issues remain visible.
 */

const isDebugEnabled = process.env.NODE_ENV !== "production";

export const logger = {
  debug: (...args: unknown[]): void => {
    if (isDebugEnabled) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};
