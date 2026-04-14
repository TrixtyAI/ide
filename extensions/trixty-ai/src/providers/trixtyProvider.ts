/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Trixty. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { TrixtyAuthManager } from '../auth/authManager';

export interface TrixtyModel {
	name: string;
	provider: string;
	details: string;
}

export interface TrixtyChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface TrixtyInitData {
	balance: number;
	models: string[];
	personalities: Array<{ _id: string; name: string }>;
	skills: Array<{ _id: string; name: string; description: string }>;
}

export class TrixtyProvider {
	private readonly outputChannel: vscode.LogOutputChannel;
	private readonly authManager: TrixtyAuthManager;
	private cachedInit: TrixtyInitData | null = null;

	constructor(outputChannel: vscode.LogOutputChannel, authManager: TrixtyAuthManager) {
		this.outputChannel = outputChannel;
		this.authManager = authManager;
	}

	private get endpoint(): string {
		return vscode.workspace.getConfiguration('trixtyAI').get<string>('trixty.endpoint', 'http://localhost:3000/api/v1');
	}

	private get apiKey(): string {
		return this.authManager.getApiKey() ?? '';
	}

	// ── Health Check ─────────────────────────────────────────────────
	async isAvailable(): Promise<boolean> {
		if (!this.apiKey) {
			return false;
		}
		try {
			const response = await this.request('GET', '/cli/init');
			return response.statusCode === 200;
		} catch {
			return false;
		}
	}

	// ── Init (models, personalities, skills, balance) ────────────────
	async init(): Promise<TrixtyInitData | null> {
		if (this.cachedInit) {
			return this.cachedInit;
		}
		try {
			const data = await this.requestJson<TrixtyInitData>('GET', '/cli/init');
			if (data) {
				this.cachedInit = data;
			}
			return data;
		} catch (error) {
			this.outputChannel.error('Failed to fetch Trixty init data:', String(error));
			return null;
		}
	}

	clearCache(): void {
		this.cachedInit = null;
	}

	// ── List Models ──────────────────────────────────────────────────
	async listModels(): Promise<TrixtyModel[]> {
		const initData = await this.init();
		if (!initData) {
			return [];
		}
		return initData.models.map(name => ({
			name,
			provider: 'trixty',
			details: `Trixty AI — balance: ${initData.balance}`
		}));
	}

	// ── Streaming Chat ───────────────────────────────────────────────
	async *streamChat(
		messages: TrixtyChatMessage[],
		options?: {
			provider?: string;
			model?: string;
			personalityId?: string;
			skillId?: string;
		},
		cancellation?: vscode.CancellationToken
	): AsyncIterable<string> {
		const body = JSON.stringify({
			provider: options?.provider ?? 'auto',
			model: options?.model,
			messages,
			personalityId: options?.personalityId,
			skillId: options?.skillId
		});

		const chunks = this.streamRequest('POST', '/chat/completions', body, cancellation);

		for await (const chunk of chunks) {
			// Trixty backend returns SSE format: data: {...}
			const line = chunk.trim();
			if (!line || line === 'data: [DONE]') {
				continue;
			}

			const dataPrefix = 'data: ';
			const jsonStr = line.startsWith(dataPrefix) ? line.slice(dataPrefix.length) : line;

			try {
				const parsed = JSON.parse(jsonStr);
				const delta = parsed.choices?.[0]?.delta?.content 
							|| parsed.choices?.[0]?.message?.content 
							|| parsed.content;
				if (delta) {
					yield delta;
				}
			} catch {
				// Non-JSON line, try raw text
				if (jsonStr && jsonStr !== '[DONE]') {
					yield jsonStr;
				}
			}
		}
	}

	// ── HTTP Helpers ─────────────────────────────────────────────────
	private request(method: string, path: string, body?: string): Promise<http.IncomingMessage> {
		return new Promise((resolve, reject) => {
			const fullUrl = this.endpoint.replace(/\/$/, '') + path;
			const url = new URL(fullUrl);
			const isHttps = url.protocol === 'https:';
			const lib = isHttps ? https : http;

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Accept': 'text/event-stream'
			};

			if (this.apiKey) {
				headers['Authorization'] = `Bearer ${this.apiKey}`;
			}

			if (body) {
				headers['Content-Length'] = String(Buffer.byteLength(body));
			}

			const req = lib.request({
				hostname: url.hostname,
				port: url.port,
				path: url.pathname + url.search,
				method,
				headers,
				timeout: 30000
			}, resolve);

			req.on('error', reject);
			req.on('timeout', () => {
				req.destroy();
				reject(new Error('Trixty request timeout'));
			});

			if (body) {
				req.write(body);
			}
			req.end();
		});
	}

	private async requestJson<T>(method: string, path: string, body?: string): Promise<T | null> {
		const res = await this.request(method, path, body);
		return new Promise((resolve, reject) => {
			let data = '';
			res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
			res.on('end', () => {
				try {
					resolve(JSON.parse(data) as T);
				} catch {
					resolve(null);
				}
			});
			res.on('error', reject);
		});
	}

	private async *streamRequest(
		method: string,
		path: string,
		body: string,
		cancellation?: vscode.CancellationToken
	): AsyncIterable<string> {
		const res = await this.request(method, path, body);

		if (cancellation?.isCancellationRequested) {
			res.destroy();
			return;
		}

		let buffer = '';

		const iterator = {
			[Symbol.asyncIterator]() {
				return {
					next(): Promise<IteratorResult<string>> {
						return new Promise((resolve, reject) => {
							if (cancellation?.isCancellationRequested) {
								res.destroy();
								resolve({ done: true, value: undefined });
								return;
							}

							const onData = (chunk: Buffer) => {
								buffer += chunk.toString();
								const lines = buffer.split('\n');
								buffer = lines.pop() ?? '';

								for (const line of lines) {
									const trimmed = line.trim();
									if (trimmed) {
										cleanup();
										resolve({ done: false, value: trimmed });
										return;
									}
								}
							};

							const onEnd = () => {
								cleanup();
								if (buffer.trim()) {
									resolve({ done: false, value: buffer.trim() });
									buffer = '';
								} else {
									resolve({ done: true, value: undefined });
								}
							};

							const onError = (err: Error) => {
								cleanup();
								reject(err);
							};

							const cleanup = () => {
								res.removeListener('data', onData);
								res.removeListener('end', onEnd);
								res.removeListener('error', onError);
							};

							res.on('data', onData);
							res.on('end', onEnd);
							res.on('error', onError);
						});
					}
				};
			}
		};

		yield* iterator;
	}
}
