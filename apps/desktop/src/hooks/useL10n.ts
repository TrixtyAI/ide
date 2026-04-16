"use client";
import { useEffect, useState, useCallback } from "react";
import { trixty } from "@/api/trixty";

/**
 * A hook that provides translation capabilities and re-renders the component
 * when translations are registered or the locale changes.
 */
export function useL10n() {
    const [, setTick] = useState(0);

    useEffect(() => {
        // Subscribe to l10n changes to trigger re-renders
        return trixty.l10n.subscribe(() => setTick(t => t + 1));
    }, []);

    const t = useCallback((key: string, params?: Record<string, string>) => {
        return trixty.l10n.t(key, params);
    }, [/* trixty.l10n instance is stable */]);

    return {
        t,
        locale: trixty.l10n.getLocale(),
        setLocale: (locale: string) => trixty.l10n.setLocale(locale),
    };
}
