"use client";

import React, { useState, useEffect } from "react";
import { Package, Star, Search, ChevronLeft, RefreshCw, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useExtensions, MarketplaceEntry } from "@/context/ExtensionContext";
import { useL10n } from "@/hooks/useL10n";

function resolveIconUrl(entry: MarketplaceEntry): string | null {
  const icon = entry.manifest?.icon?.trim();
  if (!icon) return null;
  if (/^https?:\/\//i.test(icon)) return icon;

  const repo = entry.repository?.replace(/\.git$/, "");
  if (!repo?.startsWith("https://github.com/")) return null;

  const base = repo.replace("https://github.com/", "https://raw.githubusercontent.com/");
  const branch = entry.branch || "main";
  const subpath = entry.path ? `/${entry.path.replace(/^\/+|\/+$/g, "")}` : "";
  const cleanIcon = icon.replace(/^\/+/, "");
  return `${base}/${branch}${subpath}/${cleanIcon}`;
}

const AddonIcon: React.FC<{
  entry: MarketplaceEntry;
  fallbackSize: number;
  fallbackStrokeWidth?: number;
  fallbackClassName?: string;
}> = ({ entry, fallbackSize, fallbackStrokeWidth, fallbackClassName }) => {
  const [failed, setFailed] = useState(false);
  const url = resolveIconUrl(entry);

  if (!url || failed) {
    return <Package size={fallbackSize} strokeWidth={fallbackStrokeWidth} className={fallbackClassName} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      onError={() => setFailed(true)}
      className="w-full h-full object-contain"
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
    />
  );
};

const DetailsView: React.FC<{
  entry: MarketplaceEntry,
  onBack: () => void
}> = ({ entry, onBack }) => {
  const { installedIds, activeIds, installExtension, uninstallExtension, updateExtension, toggleActive, fetchFile } = useExtensions();
  const { t } = useL10n();
  const [readme, setReadme] = useState<string>(t('marketplace.loading_details'));
  const [changelog, setChangelog] = useState<string>("");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const isInstalled = installedIds.includes(entry.id);
  const isActive = activeIds.includes(entry.id);

  // Details Tabs State
  const [activeTab, setActiveTab] = useState("details");

  useEffect(() => {
    let active = true;
    fetchFile(entry, "README.md").then((text) => {
      if (active) setReadme(text || t('marketplace.no_readme'));
    });

    // Attempt CHANGELOG.md, fallback to changelog.md
    fetchFile(entry, "CHANGELOG.md").then((c) => {
      if (!c && active) {
        fetchFile(entry, "changelog.md").then((lc) => {
          if (active) setChangelog(lc || t('marketplace.no_changelog'));
        })
      } else if (active) {
        setChangelog(c);
      }
    });

    return () => { active = false; };
  }, [entry, fetchFile, t]);

  const handleInstall = async () => {
    setLoadingAction("install");
    try { await installExtension(entry); } catch (e) { alert(e); }
    setLoadingAction(null);
  };

  const handleUninstall = async () => {
    if (!confirm(t('marketplace.uninstall_confirm'))) return;
    setLoadingAction("uninstall");
    try { await uninstallExtension(entry.id); onBack(); } catch (e) { alert(e); }
    setLoadingAction(null);
  };

  const handleUpdate = async () => {
    setLoadingAction("update");
    try { await updateExtension(entry.id); alert(t('marketplace.update_success')); } catch (e) { alert(e); }
    setLoadingAction(null);
  };

  const handleToggleActive = async () => {
    setLoadingAction("toggle");
    try { await toggleActive(entry.id, !isActive); } catch (e) { alert(e); }
    setLoadingAction(null);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#1e1e1e] text-[#cccccc] flex flex-col font-sans">

      {/* Centered Container for content */}
      <div className="max-w-[1200px] w-full mx-auto flex flex-col h-full">
        {/* EXTENSION HEADER */}
        <div className="bg-[#1e1e1e] pt-10 px-10 pb-0 shrink-0">
          <button onClick={onBack} className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-[#cccccc] hover:text-white mb-8 transition-colors">
            <ChevronLeft size={14} /> {t('marketplace.back_button')}
          </button>

          <div className="flex gap-8 mb-8">
            {/* Logo */}
            <div className="w-[128px] h-[128px] bg-white/[0.03] border border-white/5 rounded-xl shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
              <AddonIcon entry={entry} fallbackSize={64} fallbackStrokeWidth={1} fallbackClassName="text-white/20" />
            </div>

            {/* Core Info */}
            <div className="flex-1 min-w-0 flex flex-col justify-start pt-1">
              <h1 className="text-[28px] font-semibold text-white tracking-tight leading-none mb-3">
                {entry.manifest?.name || entry.id}
              </h1>

              <div className="flex items-center gap-5 text-[13px] text-[#cccccc] mb-4">
                <span className="text-[#3794ff] hover:underline cursor-pointer">{entry.manifest?.author || "Unknown"}</span>
                {entry.stars != null && (
                  <span className="flex items-center gap-1.5" title={t('marketplace.github_stars')}><Star size={14} className="text-[#cccccc]" /> {entry.stars.toLocaleString()}</span>
                )}
              </div>

              <p className="text-[13px] text-[#cccccc] mb-5 font-medium">
                {entry.manifest?.description || t('marketplace.no_description')}
              </p>

              {/* Buttons */}
              <div className="flex items-center gap-3">
                {entry.id === "trixty.example-addon" ? (
                  <span className="bg-[#2d2d2d] border border-[#3d3d3d] text-[#aaaaaa] text-[13px] font-medium px-4 py-1.5 cursor-not-allowed shadow-none select-none">
                    {t('marketplace.not_available')}
                  </span>
                ) : !isInstalled ? (
                  <button onClick={handleInstall} disabled={loadingAction !== null} className="bg-blue-600 text-white text-[13px] font-medium px-6 py-1.5 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors shadow-lg shadow-blue-500/10">
                    {loadingAction === "install" ? t('marketplace.installing') : t('marketplace.install_button')}
                  </button>
                ) : (
                  <>
                    <button onClick={handleUpdate} disabled={loadingAction !== null} className="bg-blue-600 text-white text-[13px] font-medium px-4 py-1.5 rounded-lg hover:bg-blue-500 flex items-center gap-2 disabled:opacity-50 transition-colors shadow-lg shadow-blue-500/10" title="Update locally">
                      {loadingAction === "update" ? <RefreshCw size={13} strokeWidth={1.5} className="animate-spin" /> : null}
                      {t('marketplace.update_button', { version: entry.manifest?.version || "Latest" })}
                    </button>
                    <button onClick={handleToggleActive} disabled={loadingAction !== null} className="bg-white/5 border border-white/10 text-white text-[13px] font-medium px-4 py-1.5 rounded-lg hover:bg-white/10 disabled:opacity-50 transition-colors">
                      {isActive ? t('marketplace.disable_button') : t('marketplace.enable_button')}
                    </button>
                    <button onClick={handleUninstall} disabled={loadingAction !== null} className="bg-white/5 border border-white/10 text-white text-[13px] font-medium px-4 py-1.5 rounded-lg hover:bg-white/10 disabled:opacity-50 transition-colors">
                      {t('marketplace.uninstall_button')}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* TABS */}
          <div className="flex items-center gap-8 mt-2 border-b border-[#2d2d2d]">
            {["details", "changelog"].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`text-[12px] pb-2 font-medium tracking-wide transition-colors relative top-[1px] border-b-2 ${activeTab === tab ? "text-white border-[#007acc]" : "text-[#cccccc] border-transparent hover:text-white"
                  }`}
              >
                {t(`marketplace.tabs.${tab}`)}
              </button>
            ))}
          </div>
        </div>

        {/* CONTENT AREA */}
        <div className="flex-1 flex px-10 py-8 gap-16 bg-[#1e1e1e]">
          {/* Markdown side */}
          <div className="flex-1 min-w-0">
            <div className="prose prose-invert prose-sm max-w-none prose-headings:font-normal prose-headings:text-white prose-a:text-[#3794ff] prose-code:text-[#d4d4d4] prose-code:bg-[#252526] prose-pre:bg-[#252526] prose-pre:border prose-pre:border-[#2d2d2d]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {activeTab === "details" ? readme : changelog}
              </ReactMarkdown>
            </div>
          </div>

          {/* Right Sidebar Info metadata */}
          <div className="w-[300px] shrink-0 flex flex-col gap-10 text-[13px]">
            {/* Installation Box */}
            <div>
              <h3 className="text-white font-medium mb-3 border-b border-[#2d2d2d] pb-1">{t('marketplace.metadata.installation')}</h3>
              <div className="grid grid-cols-[100px_1fr] gap-y-2">
                <span className="text-[#cccccc]">{t('marketplace.metadata.identifier')}</span><span className="text-white text-right font-mono text-[11px] select-all truncate">{entry.id}</span>
                <span className="text-[#cccccc]">{t('marketplace.metadata.version')}</span><span className="text-white text-right font-mono text-[11px]">{entry.manifest?.version || "0.0.1"}</span>
              </div>
            </div>



            {/* Categories */}
            <div>
              <h3 className="text-white font-medium mb-3 border-b border-[#2d2d2d] pb-1">{t('marketplace.metadata.categories')}</h3>
              <div className="flex flex-wrap gap-2">
                {(entry.manifest?.categories?.length ? entry.manifest.categories : [t('marketplace.metadata.other')]).map((cat, i) => (
                  <span key={i} className="text-[12px] bg-[#252526] border border-[#333333] px-3 py-1 rounded cursor-pointer hover:bg-[#2d2d2d] text-[#cccccc] transition-colors">{cat}</span>
                ))}
              </div>
            </div>

            {/* Resources */}
            <div>
              <h3 className="text-white font-medium mb-3 border-b border-[#2d2d2d] pb-1">{t('marketplace.metadata.resources')}</h3>
              <ul className="space-y-2 text-blue-400">
                <li><a href={entry.repository} target="_blank" className="hover:underline flex items-center gap-3"><ExternalLink size={14} strokeWidth={1.5} className="text-[#555]" /> {t('marketplace.metadata.repository')}</a></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const MarketplaceView: React.FC = () => {
  const { catalog, installedIds, loading, hasAttemptedCatalogLoad, error, refreshCatalog } = useExtensions();
  const { t } = useL10n();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<MarketplaceEntry | null>(null);

  // Load the remote catalog lazily: the marketplace used to fetch registry +
  // per-entry manifests + GitHub stars on every boot even when the user never
  // opened it. We now defer that work to the first mount of this view.
  //
  // `refreshCatalog` self-dedupes via an internal in-flight ref, so React 18
  // StrictMode's double-invoke and any remount-after-failure both collapse to
  // a single fetch. We deliberately do not guard on `!error` here — that
  // would leave users stuck on the error state with no retry path.
  useEffect(() => {
    if (catalog.length === 0) {
      refreshCatalog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (selectedEntry) {
    return <DetailsView entry={selectedEntry} onBack={() => setSelectedEntry(null)} />;
  }

  // Treat the pre-attempt window as "still loading" so we don't flash the
  // empty-state UI before the deferred fetch starts.
  const showLoading = loading || !hasAttemptedCatalogLoad;

  const displayedCatalog = catalog.filter(ext => {
    const matchesSearch = (ext.manifest?.name || ext.id).toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "installed" && installedIds.includes(ext.id));
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#0e0e0e] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0e0e0e]/95 backdrop-blur-sm border-b border-[#1a1a1a] px-8 py-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/10">
            <Package size={20} className="text-white/70" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white tracking-tight">{t('extensions.title')}</h1>
            <p className="text-[12px] text-[#666]">{t('marketplace.desc')}</p>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('marketplace.search_placeholder')}
              aria-label={t('marketplace.search_placeholder')}
              className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg py-2 pl-9 pr-4 text-[13px] text-white placeholder-[#555] focus:outline-none focus:border-[#555] transition-colors"
            />
            <Search size={14} className="absolute left-3 top-[10px] text-[#555]" />
          </div>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            aria-label={t('marketplace.title')}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 text-[12px] text-[#aaa] focus:outline-none cursor-pointer"
          >
            <option value="all">{t('marketplace.filter_all', { count: catalog.length.toString() })}</option>
            <option value="installed">{t('marketplace.filter_installed', { count: installedIds.length.toString() })}</option>
          </select>
        </div>
      </div>

      {showLoading ? (
        <div className="flex-1 flex items-center justify-center py-20 text-[13px] text-[#666]">{t('marketplace.loading_catalog')}</div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center py-20 text-[13px] text-red-500">{t('common.error', { message: error })}</div>
      ) : displayedCatalog.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-20 text-[13px] text-[#555]">{t('marketplace.no_extensions')}</div>
      ) : (
        <div className="px-8 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {displayedCatalog.map((ext) => (
              <div
                key={ext.id}
                onClick={() => setSelectedEntry(ext)}
                className="bg-[#141414] border border-[#1e1e1e] rounded-xl p-5 hover:border-[#333] transition-all cursor-pointer group"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 bg-white/5 rounded-lg flex items-center justify-center shrink-0 border border-transparent group-hover:bg-white/10 group-hover:border-white/5 transition-colors overflow-hidden">
                    <AddonIcon entry={ext} fallbackSize={18} fallbackClassName="text-white/40" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13px] font-semibold text-white truncate">{ext.manifest?.name || ext.id}</h3>
                    <p className="text-[11px] text-[#555] truncate">{ext.manifest?.author || ext.repository}</p>
                  </div>
                </div>

                <p className="text-[12px] text-[#777] mb-4 line-clamp-2 leading-relaxed min-h-[36px]">
                  {ext.manifest?.description || t('marketplace.no_description')}
                </p>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[11px] text-[#444]">
                    <span>v{ext.manifest?.version || "1.0.0"}</span>
                    {ext.stars != null && (
                      <span className="flex items-center gap-1" title={t('marketplace.github_stars')}>
                        <Star size={10} /> {ext.stars.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-medium">
                    {installedIds.includes(ext.id) ? (
                      <span className="text-[#666]">{t('marketplace.installed_badge')}</span>
                    ) : (
                      <span className="text-white group-hover:underline">{t('marketplace.view_install')}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketplaceView;
