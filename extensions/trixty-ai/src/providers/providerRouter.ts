/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Trixty. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { OllamaProvider } from './ollamaProvider';
import { TrixtyProvider } from './trixtyProvider';

export interface ModelInfo {
	name: string;
	provider: string;
	details: string;
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

type ProviderMode = 'auto' | 'ollama' | 'trixty';

export class ProviderRouter {
	private readonly ollama: OllamaProvider;
	private readonly trixty: TrixtyProvider;
	private readonly outputChannel: vscode.LogOutputChannel;

	// Cache provider availability for 30 seconds
	private ollamaAvailable: boolean | null = null;
	private trixtyAvailable: boolean | null = null;
	private lastCheck = 0;
	private readonly CACHE_TTL = 30_000;

	constructor(
		ollama: OllamaProvider,
		trixty: TrixtyProvider,
		outputChannel: vscode.LogOutputChannel
	) {
		this.ollama = ollama;
		this.trixty = trixty;
		this.outputChannel = outputChannel;
	}

	private get mode(): ProviderMode {
		return vscode.workspace.getConfiguration('trixtyAI').get<ProviderMode>('provider', 'auto');
	}

	// ── Provider Availability ────────────────────────────────────────
	private async refreshAvailability(): Promise<void> {
		const now = Date.now();
		if (now - this.lastCheck < this.CACHE_TTL && this.ollamaAvailable !== null) {
			return;
		}

		this.lastCheck = now;
		const [ollamaOk, trixtyOk] = await Promise.all([
			this.ollama.isAvailable(),
			this.trixty.isAvailable()
		]);

		this.ollamaAvailable = ollamaOk;
		this.trixtyAvailable = trixtyOk;

		this.outputChannel.debug(`Provider availability — Ollama: ${ollamaOk}, Trixty: ${trixtyOk}`);
	}

	async getActiveProviderName(): Promise<string> {
		const mode = this.mode;
		if (mode !== 'auto') {
			return mode;
		}

		await this.refreshAvailability();

		if (this.ollamaAvailable) {
			return 'ollama';
		}
		if (this.trixtyAvailable) {
			return 'trixty';
		}
		return 'none';
	}

	// ── Streaming Chat ───────────────────────────────────────────────
	async *streamChat(
		messages: ChatMessage[],
		cancellation?: vscode.CancellationToken
	): AsyncIterable<string> {
		const provider = await this.selectProvider();

		if (provider === 'ollama') {
			this.outputChannel.info('Routing chat to Ollama');
			yield* this.ollama.streamChat(messages, undefined, cancellation);
		} else if (provider === 'trixty') {
			this.outputChannel.info('Routing chat to Trixty AI');
			yield* this.trixty.streamChat(messages, undefined, cancellation);
		} else {
			yield 'No AI provider available. Please start Ollama or configure Trixty AI credentials.';
		}
	}

	// ── Inline Completion ────────────────────────────────────────────
	async getInlineCompletion(
		prompt: string,
		suffix: string,
		cancellation?: vscode.CancellationToken
	): Promise<string> {
		const provider = await this.selectProvider();

		if (provider === 'ollama') {
			return this.ollama.complete(prompt, suffix);
		} else if (provider === 'trixty') {
			// For Trixty, use chat completions in a FIM-style prompt
			const parts: string[] = [];
			const messages: ChatMessage[] = [{
				role: 'system',
				content: 'You are a code completion assistant. Complete the code between the prefix and suffix. Only output the completion, nothing else.'
			}, {
				role: 'user',
				content: `Complete this code:\n\n${prompt}[CURSOR]${suffix}`
			}];

			for await (const chunk of this.trixty.streamChat(messages, undefined, cancellation)) {
				parts.push(chunk);
			}
			return parts.join('');
		}

		return '';
	}

	// ── List All Models ──────────────────────────────────────────────
	async listModels(): Promise<ModelInfo[]> {
		const results: ModelInfo[] = [];

		try {
			const ollamaModels = await this.ollama.listModels();
			for (const m of ollamaModels) {
				results.push({
					name: m.name,
					provider: 'ollama',
					details: `${m.details.parameterSize} — ${m.details.quantizationLevel}`
				});
			}
		} catch {
			this.outputChannel.debug('Could not list Ollama models');
		}

		try {
			const trixtyModels = await this.trixty.listModels();
			results.push(...trixtyModels);
		} catch {
			this.outputChannel.debug('Could not list Trixty models');
		}

		return results;
	}

	// ── Provider Selection ───────────────────────────────────────────
	private async selectProvider(): Promise<'ollama' | 'trixty' | 'none'> {
		const mode = this.mode;

		if (mode === 'ollama') {
			return 'ollama';
		}
		if (mode === 'trixty') {
			return 'trixty';
		}

		// Auto mode: prefer Ollama (local, zero latency), fallback to Trixty
		await this.refreshAvailability();

		if (this.ollamaAvailable) {
			return 'ollama';
		}
		if (this.trixtyAvailable) {
			return 'trixty';
		}

		this.outputChannel.warn('No AI provider available');
		return 'none';
	}
}
