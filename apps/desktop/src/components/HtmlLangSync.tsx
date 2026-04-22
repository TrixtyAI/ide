"use client";

import { useEffect } from "react";
import { useL10n } from "@/hooks/useL10n";

/**
 * Keeps `<html lang>` in sync with the current UI locale. The root `layout.tsx`
 * is a server component so it cannot subscribe to the client-side l10n store;
 * this no-render client component bridges the two.
 */
const HtmlLangSync: React.FC = () => {
  const { locale } = useL10n();
  useEffect(() => {
    if (typeof document !== "undefined" && locale) {
      document.documentElement.lang = locale;
    }
  }, [locale]);
  return null;
};

export default HtmlLangSync;
