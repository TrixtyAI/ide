/**
 * Trixty IDE - Hello World Example Addon (Sandboxed)
 *
 * This extension runs inside a Web Worker sandbox. It cannot reach the
 * DOM, the `window` object, `React`, Tauri IPC, or any other extension.
 * Everything it can do is mediated through `ctx`, which only exposes the
 * capabilities this extension's `package.json` declares under
 * `trixty.capabilities`.
 *
 * UI is declarative: return a tree of `{ tag, props, children }` nodes
 * from a view's `render()` function. The host turns that into real
 * React elements on the main thread. Event handlers are functions on
 * `props.onClick` / `props.onChange`; the sandbox assigns them handler
 * ids and round-trips the event back to this code.
 */

module.exports = {
    activate: async function (ctx) {
        console.log("[Hello World Addon] Activated (sandboxed).");

        // --- Localization ---
        // Extensions can register their own strings or contribute new
        // locales. Requires the `l10n:register` capability.
        await ctx.l10n.registerTranslations('en', {
            'example.snippets.title': 'My Code Snippets',
            'example.snippets.add_header': 'Snippet Header...',
            'example.snippets.add_code': 'Paste your code here...',
            'example.snippets.save': 'Save Snippet',
            'example.snippets.saved_msg': 'Snippet saved to storage.',
            'example.snippets.copied_msg': 'Snippet copied to clipboard.'
        });
        await ctx.l10n.registerTranslations('es', {
            'example.snippets.title': 'Mis Fragmentos',
            'example.snippets.add_header': 'Cabecera del Snippet...',
            'example.snippets.add_code': 'Pega tu código aquí...',
            'example.snippets.save': 'Guardar Fragmento',
            'example.snippets.saved_msg': 'Snippet guardado en el almacenamiento.',
            'example.snippets.copied_msg': 'Snippet copiado al portapapeles.'
        });
        await ctx.l10n.registerTranslations('fr', {
            'explorer.title': 'Explorateur',
            'search.title': 'Recherche',
            'git.title': 'Contrôle de Source',
            'example.snippets.title': 'Mes Extraits'
        });

        // --- Custom Language ---
        // Requires the `lang:register` capability.
        await ctx.languages.register({
            id: 'trixty-dsl',
            extensions: ['.txs'],
            aliases: ['Trixty DSL', 'trixty']
        });
        await ctx.languages.setMonarchTokens('trixty-dsl', {
            tokenizer: {
                root: [
                    [/\[[a-zA-Z0-9_]+\]/, "custom-tag"],
                    [/"[^"]*"/, "string"],
                    [/\/\/.*/, "comment"],
                    [/\b(if|else|while|return|function|const|var|let)\b/, "keyword"]
                ]
            }
        });
        await ctx.languages.setConfiguration('trixty-dsl', {
            comments: { lineComment: '//', blockComment: ['/*', '*/'] },
            brackets: [['{', '}'], ['[', ']'], ['(', ')']]
        });
        await ctx.languages.setIndentation('trixty-dsl', {
            tabSize: 2,
            insertSpaces: true
        });

        // --- Right Panel: Hacker Clock ---
        // UI is a pure function of state. The sandbox tracks `useState`
        // slots per view and re-renders the whole schema whenever a
        // setter runs.
        await ctx.window.registerRightPanelView({
            id: 'example.hacker.clock',
            title: 'Hacker Clock',
            icon: { name: 'Clock', size: 14, className: 'text-blue-500' },
            render() {
                const [time, setTime] = ctx.ui.useState(new Date().toLocaleTimeString());

                ctx.ui.useEffect(() => {
                    const timer = setInterval(
                        () => setTime(new Date().toLocaleTimeString()),
                        1000,
                    );
                    return () => clearInterval(timer);
                }, []);

                return {
                    tag: 'div',
                    props: { className: 'p-6 flex flex-col items-center justify-center text-[#ccc] bg-[#111] h-full' },
                    children: [
                        { tag: 'icon', props: { iconName: 'Clock', iconSize: 32, className: 'mb-4 text-blue-500' } },
                        { tag: 'h1', props: { className: 'text-lg mb-2 font-bold text-white' }, children: 'System Time' },
                        { tag: 'p', props: { className: 'text-3xl text-blue-400 font-mono tracking-widest' }, children: time },
                        { tag: 'div', props: { className: 'mt-6 text-[10px] text-[#666] text-center' }, children: 'Hello World Addon (Right Panel)' }
                    ]
                };
            }
        });

        // --- Left Panel: Snippet Manager ---
        await ctx.window.registerLeftPanelView({
            id: 'example.sidebar.feature',
            title: 'My Snippets',
            icon: { name: 'Rocket', size: 20 },
            render() {
                const [snippets, setSnippets] = ctx.ui.useState([
                    { id: '1', title: 'Setup React', code: 'import React, { useState } from "react";' }
                ]);
                const [title, setTitle] = ctx.ui.useState('');
                const [code, setCode] = ctx.ui.useState('');

                // Load persisted snippets once. Requires `storage:read`
                // and `storage:write` capabilities.
                ctx.ui.useEffect(() => {
                    ctx.storage.get('snippets', []).then((saved) => {
                        if (Array.isArray(saved) && saved.length) setSnippets(saved);
                    });
                }, []);

                const persist = (next) => {
                    setSnippets(next);
                    ctx.storage.set('snippets', next).catch(() => {});
                };

                const addSnippet = () => {
                    if (!title.trim() || !code.trim()) return;
                    const next = [{ id: String(Date.now()), title, code }, ...snippets];
                    persist(next);
                    setTitle('');
                    setCode('');
                    ctx.window.showInformationMessage(ctx.l10n.t('example.snippets.saved_msg'));
                };

                const deleteSnippet = (id) => {
                    persist(snippets.filter((s) => s.id !== id));
                };

                const copySnippet = (snippetCode) => {
                    ctx.clipboard.writeText(snippetCode).catch(() => {});
                    ctx.window.showInformationMessage(ctx.l10n.t('example.snippets.copied_msg'));
                };

                return {
                    tag: 'div',
                    props: { className: 'flex flex-col h-full select-none' },
                    children: [
                        // Header
                        {
                            tag: 'div',
                            props: { className: 'h-[40px] flex items-center justify-between px-4 border-b border-[#1a1a1a] shrink-0' },
                            children: [
                                { tag: 'span', props: { className: 'text-[10px] font-semibold text-[#555] uppercase tracking-widest' }, children: ctx.l10n.t('example.snippets.title') }
                            ]
                        },
                        // Content
                        {
                            tag: 'div',
                            props: { className: 'flex-1 p-3' },
                            children: [
                                // Input form
                                {
                                    tag: 'div',
                                    props: { className: 'bg-[#111] border border-[#222] rounded-xl p-3 flex flex-col gap-2' },
                                    children: [
                                        {
                                            tag: 'input',
                                            props: {
                                                value: title,
                                                placeholder: ctx.l10n.t('example.snippets.add_header'),
                                                className: 'bg-transparent text-[11px] font-bold text-white outline-none placeholder-[#555]',
                                                onChange: (event) => setTitle(event.value)
                                            }
                                        },
                                        {
                                            tag: 'textarea',
                                            props: {
                                                value: code,
                                                placeholder: ctx.l10n.t('example.snippets.add_code'),
                                                className: 'bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-2 text-[11px] font-mono text-[#aaa] h-[60px] resize-none outline-none focus:border-[#444] transition-colors',
                                                onChange: (event) => setCode(event.value)
                                            }
                                        },
                                        {
                                            tag: 'button',
                                            props: {
                                                disabled: !title.trim() || !code.trim(),
                                                className: 'mt-1 w-full py-1.5 bg-white text-black font-semibold text-[10px] rounded hover:bg-white/90 disabled:opacity-30 transition-all',
                                                onClick: addSnippet
                                            },
                                            children: ctx.l10n.t('example.snippets.save')
                                        }
                                    ]
                                },
                                // List
                                {
                                    tag: 'ul',
                                    props: { className: 'flex flex-col gap-2 mt-3' },
                                    children: snippets.map((s) => ({
                                        tag: 'li',
                                        key: s.id,
                                        props: { className: 'bg-[#141414] border border-[#222] rounded-lg overflow-hidden' },
                                        children: [
                                            {
                                                tag: 'div',
                                                props: { className: 'px-3 py-2 border-b border-[#1a1a1a] flex justify-between items-center bg-[#181818]' },
                                                children: [
                                                    { tag: 'span', props: { className: 'text-[11px] text-[#ddd] font-semibold' }, children: s.title },
                                                    {
                                                        tag: 'div',
                                                        props: { className: 'flex gap-1' },
                                                        children: [
                                                            { tag: 'button', props: { className: 'text-[#666] hover:text-white p-1 text-[10px]', onClick: () => copySnippet(s.code) }, children: 'copy' },
                                                            { tag: 'button', props: { className: 'text-[#666] hover:text-red-400 p-1 text-[10px]', onClick: () => deleteSnippet(s.id) }, children: 'delete' }
                                                        ]
                                                    }
                                                ]
                                            },
                                            {
                                                tag: 'pre',
                                                props: { className: 'p-3 bg-[#0a0a0a] text-[10px] text-[#888] font-mono' },
                                                children: s.code
                                            }
                                        ]
                                    }))
                                }
                            ]
                        }
                    ]
                };
            }
        });

        await ctx.window.showInformationMessage("Example Addon loaded inside sandbox.");
    }
};
