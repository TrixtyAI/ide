"use client";
import { useCallback, useSyncExternalStore } from "react";
import { trixty } from "@/api/trixty";

// Server snapshot for `useSyncExternalStore`. Next runs static prerender over
// the client subtree, and without a third `getServerSnapshot` argument React
// throws `Missing getServerSnapshot, which is required for server-rendered
// content` during build. The same memoized snapshot is safe because
// `L10nRegistry` only mutates it via `notify()` — never mid-render — and the
// initial value before any subscriber attaches is already `{ locale: 'en',
// version: 0 }`, which is what we want on the server.
const getL10nServerSnapshot = () => trixty.l10n.getSnapshot();

/**
 * A hook that provides translation capabilities and re-renders the component
 * when translations are registered or the locale changes.
 */
export function useL10n() {
    const { locale } = useSyncExternalStore(
        trixty.l10n.subscribe,
        trixty.l10n.getSnapshot,
        getL10nServerSnapshot,
    );

    const t = useCallback((key: string, params?: Record<string, string>) => {
        return trixty.l10n.t(key, params);
    }, []);

    return {
        t,
        locale,
        setLocale: (locale: string) => trixty.l10n.setLocale(locale),
    };
}
