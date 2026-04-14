/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Trixty. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { OllamaProvider } from './providers/ollamaProvider';
import { TrixtyProvider } from './providers/trixtyProvider';
import { ProviderRouter } from './providers/providerRouter';
import { TrixtyInlineCompletionProvider } from './completions/inlineCompletionProvider';
import { TrixtyAuthManager } from './auth/authManager';

let router: ProviderRouter;
let authManager: TrixtyAuthManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel('Trixty AI', { log: true });
	outputChannel.info('Trixty AI extension activating...');

	// ── Auth Manager ─────────────────────────────────────────────────
	authManager = new TrixtyAuthManager(context, outputChannel);

	// ── Providers ────────────────────────────────────────────────────
	const ollamaProvider = new OllamaProvider(outputChannel);
	const trixtyProvider = new TrixtyProvider(outputChannel, authManager);
	router = new ProviderRouter(ollamaProvider, trixtyProvider, outputChannel);

	// ── Inline Completions ───────────────────────────────────────────
	const config = vscode.workspace.getConfiguration('trixtyAI');
	if (config.get<boolean>('completions.enabled', true)) {
		const inlineProvider = new TrixtyInlineCompletionProvider(router, outputChannel);
		context.subscriptions.push(
			vscode.languages.registerInlineCompletionItemProvider(
				{ pattern: '**' },
				inlineProvider
			)
		);
		outputChannel.info('Inline completions provider registered.');
	}

	// ── Status Bar ───────────────────────────────────────────────────
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBar.command = 'trixty.ai.toggleStatusMenu';
	statusBar.text = '$(sparkle) Trixty AI';
	statusBar.tooltip = 'Trixty AI — Click for options';
	statusBar.show();
	context.subscriptions.push(statusBar);

	// Update status bar based on provider availability
	const updateStatus = async () => {
		const available = await router.getActiveProviderName();
		statusBar.text = `$(sparkle) Trixty AI (${available})`;
	};
	updateStatus();

	// ── Commands ─────────────────────────────────────────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand('trixty.ai.signIn', async () => {
			await authManager.signIn();
			updateStatus();
		}),

		vscode.commands.registerCommand('trixty.ai.signOut', async () => {
			await authManager.signOut();
			updateStatus();
		}),

		vscode.commands.registerCommand('trixty.ai.selectModel', async () => {
			const models = await router.listModels();
			const picked = await vscode.window.showQuickPick(
				models.map(m => ({
					label: m.name,
					description: m.provider,
					detail: m.details
				})),
				{ placeHolder: 'Select an AI model' }
			);
			if (picked) {
				outputChannel.info(`Selected model: ${picked.label} (${picked.description})`);
				// Store selected model preference
				const config = vscode.workspace.getConfiguration('trixtyAI');
				if (picked.description === 'ollama') {
					await config.update('ollama.chatModel', picked.label, vscode.ConfigurationTarget.Global);
				}
			}
		}),

		vscode.commands.registerCommand('trixty.ai.toggleStatusMenu', async () => {
			const items: vscode.QuickPickItem[] = [
				{ label: '$(account) Sign In / Sign Out', description: authManager.isSignedIn ? 'Signed in' : 'Not signed in' },
				{ label: '$(settings-gear) Settings', description: 'Open Trixty AI settings' },
				{ label: '$(list-selection) Select Model', description: 'Choose AI model' },
				{ label: '$(info) About', description: 'Trixty AI v1.0.0' }
			];
			const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Trixty AI' });
			if (picked) {
				switch (picked.label) {
					case '$(account) Sign In / Sign Out':
						authManager.isSignedIn
							? vscode.commands.executeCommand('trixty.ai.signOut')
							: vscode.commands.executeCommand('trixty.ai.signIn');
						break;
					case '$(settings-gear) Settings':
						vscode.commands.executeCommand('workbench.action.openSettings', 'trixtyAI');
						break;
					case '$(list-selection) Select Model':
						vscode.commands.executeCommand('trixty.ai.selectModel');
						break;
				}
			}
		}),

		vscode.commands.registerCommand('trixty.ai.refreshToken', async () => {
			await authManager.refreshToken();
		}),

		vscode.commands.registerCommand('trixty.ai.git.generateCommitMessage', async () => {
			outputChannel.info('Generating commit message...');
			// TODO: Implement git diff analysis + AI commit message generation
			vscode.window.showInformationMessage('Trixty AI: Commit message generation coming soon!');
		}),

		vscode.commands.registerCommand('trixty.ai.git.resolveMergeConflicts', async () => {
			outputChannel.info('Resolving merge conflicts...');
			// TODO: Implement merge conflict resolution
			vscode.window.showInformationMessage('Trixty AI: Merge conflict resolution coming soon!');
		}),

		vscode.commands.registerCommand('trixty.ai.open.walkthrough', () => {
			vscode.window.showInformationMessage('Welcome to Trixty AI! Configure your provider in Settings.');
		}),

		vscode.commands.registerCommand('trixty.ai.debug.extensionState', () => {
			const state = {
				signedIn: authManager.isSignedIn,
				provider: vscode.workspace.getConfiguration('trixtyAI').get('provider'),
				ollamaEndpoint: vscode.workspace.getConfiguration('trixtyAI').get('ollama.endpoint'),
				trixtyEndpoint: vscode.workspace.getConfiguration('trixtyAI').get('trixty.endpoint'),
			};
			outputChannel.info('Extension state: ' + JSON.stringify(state, null, 2));
			outputChannel.show();
		})
	);

	// ── Config change listener ───────────────────────────────────────
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('trixtyAI')) {
				updateStatus();
			}
		})
	);

	outputChannel.info('Trixty AI extension activated successfully.');
}

export function deactivate(): void {
	// Cleanup handled by disposables
}
