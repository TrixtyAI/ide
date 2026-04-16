/**
 * Trixty IDE - Hello World Example Addon
 * 
 * This file demonstrates how to create a dynamic Extension that is fully
 * evaluated in the Trixty Host Sandbox using CommonJS syntax.
 * 
 * The global variables `React`, `LucideIcons`, and `trixty` are automatically 
 * injected by the host and are ready to use.
 */

module.exports = {
    activate: function(ctx) {
        console.log("[Hello World Addon] Activated!");
        const e = React.createElement;
        const { Clock, Rocket, Terminal, Copy, Trash2 } = LucideIcons;

        // --- Localization Demo ---
        // Addons can register their own strings or even whole new languages!
        ctx.l10n.registerTranslations('en', {
            'example.snippets.title': 'My Code Snippets',
            'example.snippets.add_header': 'Snippet Header...',
            'example.snippets.add_code': 'Paste your code here...',
            'example.snippets.save': 'Save Snippet',
            'example.snippets.saved_msg': 'Snippet saved to LocalStorage!',
            'example.snippets.copied_msg': 'Snippet copied to clipboard!'
        });

        ctx.l10n.registerTranslations('es', {
            'example.snippets.title': 'Mis Fragmentos',
            'example.snippets.add_header': 'Cabecera del Snippet...',
            'example.snippets.add_code': 'Pega tu código aquí...',
            'example.snippets.save': 'Guardar Fragmento',
            'example.snippets.saved_msg': '¡Snippet guardado en LocalStorage!',
            'example.snippets.copied_msg': '¡Snippet copiado al portapapeles!'
        });

        // Contributed language: French (Just for demo)
        ctx.l10n.registerTranslations('fr', {
            'explorer.title': 'Explorateur',
            'search.title': 'Recherche',
            'git.title': 'Contrôle de Source',
            'example.snippets.title': 'Mes Extraits'
        });

        // --- Custom Language Demo ---
        // Addons can contribute new programming languages to the editor!
        ctx.languages.register({ 
            id: 'trixty-dsl', 
            extensions: ['.txs'],
            aliases: ['Trixty DSL', 'trixty']
        });

        ctx.languages.setMonarchTokens('trixty-dsl', {
            tokenizer: {
                root: [
                    [/\[[a-zA-Z0-9_]+\]/, "custom-tag"],
                    [/\"[^\"]*\"/, "string"],
                    [/\/\/.*/, "comment"],
                    [/\b(if|else|while|return|function|const|var|let)\b/, "keyword"]
                ]
            }
        });

        ctx.languages.setConfiguration('trixty-dsl', {
            comments: {
                lineComment: '//',
                blockComment: ['/*', '*/']
            },
            brackets: [
                ['{', '}'],
                ['[', ']'],
                ['(', ')']
            ]
        });

        ctx.languages.setIndentation('trixty-dsl', {
            tabSize: 2,
            insertSpaces: true
        });

        // 1. A Component for the Right Panel (Hacker Clock)
        function ClockComponent() {
            const [time, setTime] = React.useState(new Date().toLocaleTimeString());
            
            React.useEffect(() => {
                const timer = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
                return () => clearInterval(timer);
            }, []);

            return e('div', { className: 'p-6 flex flex-col items-center justify-center text-[#ccc] bg-[#111] h-full' },
                e(Clock, { size: 32, className: 'mb-4 text-blue-500' }),
                e('h1', { className: 'text-lg mb-2 font-bold text-white' }, 'System Time'),
                e('p', { className: 'text-3xl text-blue-400 font-mono tracking-widest' }, time),
                e('div', { className: 'mt-6 text-[10px] text-[#666] text-center' }, 'Hello World Addon (Right Panel)')
            );
        }

        // 2. A Component for the Left Sidebar (Trixty Snippets Manager)
        function LeftPanelComponent() {
            const [, setTick] = React.useState(0);
            const [snippets, setSnippets] = React.useState(() => {
                const saved = localStorage.getItem('trixty-example-snippets');
                return saved ? JSON.parse(saved) : [
                    { id: '1', title: 'Setup React', code: 'import React, { useState } from "react";' }
                ];
            });
            const [title, setTitle] = React.useState('');
            const [code, setCode] = React.useState('');

            React.useEffect(() => {
                // Subscribe to l10n changes to re-render when user switches language
                return ctx.l10n.subscribe(() => setTick(t => t + 1));
            }, []);

            React.useEffect(() => {
                localStorage.setItem('trixty-example-snippets', JSON.stringify(snippets));
            }, [snippets]);

            const t = (key) => ctx.l10n.t(key);

            const addSnippet = () => {
                if (!title.trim() || !code.trim()) return;
                setSnippets([{ id: Date.now().toString(), title, code }, ...snippets]);
                setTitle('');
                setCode('');
                ctx.window.showInformationMessage(t('example.snippets.saved_msg'));
            };

            const copySnippet = (snippetCode) => {
                navigator.clipboard.writeText(snippetCode);
                ctx.window.showInformationMessage(t('example.snippets.copied_msg'));
            };

            const deleteSnippet = (id) => {
                setSnippets(snippets.filter(s => s.id !== id));
            };

            return e('div', { className: 'flex flex-col h-full select-none' },
                // Header
                e('div', { className: 'h-[40px] flex items-center justify-between px-4 border-b border-[#1a1a1a] shrink-0' },
                    e('span', { className: 'text-[10px] font-semibold text-[#555] uppercase tracking-widest' }, t('example.snippets.title'))
                ),
                
                // Content
                e('div', { className: 'flex-1 overflow-y-auto scrollbar-thin p-3 flex flex-col gap-4' },
                    // Input Form
                    e('div', { className: 'bg-[#111] border border-[#222] rounded-xl p-3 flex flex-col gap-2' },
                        e('input', { 
                            value: title, 
                            onChange: (event) => setTitle(event.target.value),
                            placeholder: t('example.snippets.add_header'),
                            className: 'bg-transparent text-[11px] font-bold text-white outline-none placeholder-[#555]'
                        }),
                        e('textarea', {
                            value: code,
                            onChange: (event) => setCode(event.target.value),
                            placeholder: t('example.snippets.add_code'),
                            className: 'bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-2 text-[11px] font-mono text-[#aaa] h-[60px] resize-none outline-none focus:border-[#444] transition-colors'
                        }),
                        e('button', {
                            onClick: addSnippet,
                            disabled: !title.trim() || !code.trim(),
                            className: 'mt-1 w-full py-1.5 bg-white text-black font-semibold text-[10px] rounded hover:bg-white/90 disabled:opacity-30 transition-all'
                        }, t('example.snippets.save'))
                    ),

                    // List
                    e('div', { className: 'flex flex-col gap-2' },
                        snippets.map(s => 
                            e('div', { key: s.id, className: 'group bg-[#141414] border border-[#222] hover:border-[#333] transition-colors rounded-lg overflow-hidden' },
                                e('div', { className: 'px-3 py-2 border-b border-[#1a1a1a] flex justify-between items-center bg-[#181818]' },
                                    e('span', { className: 'text-[11px] text-[#ddd] font-semibold' }, s.title),
                                    e('div', { className: 'flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity' },
                                        e('button', { onClick: () => copySnippet(s.code), className: 'text-[#666] hover:text-white p-1' }, e(Copy, { size: 12 })),
                                        e('button', { onClick: () => deleteSnippet(s.id), className: 'text-[#666] hover:text-red-400 p-1' }, e(Trash2, { size: 12 }))
                                    )
                                ),
                                e('div', { className: 'p-3 bg-[#0a0a0a] overflow-x-auto' },
                                    e('pre', { className: 'text-[10px] text-[#888] font-mono leading-relaxed' }, s.code)
                                )
                            )
                        )
                    )
                )
            );
        }

        // --- Registers ---

        ctx.window.registerRightPanelView({
            id: 'example.hacker.clock',
            title: 'Hacker Clock',
            icon: e(Clock, { size: 14, className: 'text-blue-500' }),
            render: ClockComponent
        });

        ctx.window.registerLeftPanelView({
            id: 'example.sidebar.feature',
            title: 'My Snippets',
            icon: e(Rocket, { size: 20, strokeWidth: 1.5 }),
            render: LeftPanelComponent
        });
        
        ctx.window.showInformationMessage("Example Addon loaded and UI Registered!");
    }
};
