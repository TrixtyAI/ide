"use client";
import { useCallback, useSyncExternalStore } from "react";
import { trixty } from "@/api/trixty";

/**
 * A hook that provides translation capabilities and re-renders the component
 * when translations are registered or the locale changes.
 */
export function useL10n() {
    const { locale } = useSyncExternalStore(
        trixty.l10n.subscribe,
        trixty.l10n.getSnapshot
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
