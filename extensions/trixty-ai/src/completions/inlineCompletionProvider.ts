/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Trixty. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProviderRouter } from '../providers/providerRouter';

export class TrixtyInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private readonly router: ProviderRouter;
	private readonly outputChannel: vscode.LogOutputChannel;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private lastCompletionText = '';

	constructor(router: ProviderRouter, outputChannel: vscode.LogOutputChannel) {
		this.router = router;
		this.outputChannel = outputChannel;
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | null> {
		const config = vscode.workspace.getConfiguration('trixtyAI');
		if (!config.get<boolean>('completions.enabled', true)) {
			return null;
		}

		// Debounce
		const debounceMs = config.get<number>('completions.debounceMs', 300);
		await this.debounce(debounceMs, token);

		if (token.isCancellationRequested) {
			return null;
		}

		try {
			// Build context from surrounding code
			const prefix = this.getPrefix(document, position);
			const suffix = this.getSuffix(document, position);

			if (prefix.trim().length < 3) {
				return null; // Too little context
			}

			const completion = await this.router.getInlineCompletion(prefix, suffix, token);

			if (!completion || token.isCancellationRequested) {
				return null;
			}

			// Avoid duplicate completions
			if (completion === this.lastCompletionText) {
				return null;
			}
			this.lastCompletionText = completion;

			return [
				new vscode.InlineCompletionItem(
					completion,
					new vscode.Range(position, position)
				)
			];
		} catch (error) {
			this.outputChannel.debug('Inline completion error: ' + String(error));
			return null;
		}
	}

	private getPrefix(document: vscode.TextDocument, position: vscode.Position): string {
		// Get up to 50 lines before cursor
		const startLine = Math.max(0, position.line - 50);
		const range = new vscode.Range(startLine, 0, position.line, position.character);
		return document.getText(range);
	}

	private getSuffix(document: vscode.TextDocument, position: vscode.Position): string {
		// Get up to 10 lines after cursor
		const endLine = Math.min(document.lineCount - 1, position.line + 10);
		const range = new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length);
		return document.getText(range);
	}

	private debounce(ms: number, token: vscode.CancellationToken): Promise<void> {
		return new Promise((resolve) => {
			if (this.debounceTimer) {
				clearTimeout(this.debounceTimer);
			}
			this.debounceTimer = setTimeout(() => {
				if (!token.isCancellationRequested) {
					resolve();
				}
			}, ms);

			token.onCancellationRequested(() => {
				if (this.debounceTimer) {
					clearTimeout(this.debounceTimer);
				}
				resolve();
			});
		});
	}
}
