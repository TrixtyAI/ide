/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Trixty. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

export interface OllamaModel {
	name: string;
	modifiedAt: string;
	size: number;
	digest: string;
	details: {
		format: string;
		family: string;
		parameterSize: string;
		quantizationLevel: string;
	};
}

export interface OllamaChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface OllamaChatResponse {
	model: string;
	message: OllamaChatMessage;
	done: boolean;
}

export interface OllamaGenerateResponse {
	model: string;
	response: string;
	done: boolean;
}

export class OllamaProvider {
	private readonly outputChannel: vscode.LogOutputChannel;

	constructor(outputChannel: vscode.LogOutputChannel) {
		this.outputChannel = outputChannel;
	}

	private get endpoint(): string {
		return vscode.workspace.getConfiguration('trixtyAI').get<string>('ollama.endpoint', 'http://localhost:11434');
	}

	private get model(): string {
		return vscode.workspace.getConfiguration('trixtyAI').get<string>('ollama.model', 'codellama');
	}

	private get chatModel(): string {
		return vscode.workspace.getConfiguration('trixtyAI').get<string>('ollama.chatModel', 'llama3');
	}

	// ── Health Check ─────────────────────────────────────────────────
	async isAvailable(): Promise<boolean> {
		try {
			const response = await this.request('GET', '/api/tags');
			return response.statusCode === 200;
		} catch {
			return false;
		}
	}

	// ── List Models ──────────────────────────────────────────────────
	async listModels(): Promise<OllamaModel[]> {
		try {
			const response = await this.requestJson<{ models: OllamaModel[] }>('GET', '/api/tags');
			return response?.models ?? [];
		} catch (error) {
			this.outputChannel.error('Failed to list Ollama models:', String(error));
			return [];
		}
	}

	// ── Streaming Chat ───────────────────────────────────────────────
	async *streamChat(
		messages: OllamaChatMessage[],
		model?: string,
		cancellation?: vscode.CancellationToken
	): AsyncIterable<string> {
		const body = JSON.stringify({
			model: model ?? this.chatModel,
			messages,
			stream: true
		});

		const chunks = this.streamRequest('POST', '/api/chat', body, cancellation);

		for await (const chunk of chunks) {
			try {
				const parsed: OllamaChatResponse = JSON.parse(chunk);
				if (parsed.message?.content) {
					yield parsed.message.content;
				}
				if (parsed.done) {
					return;
				}
			} catch {
				// Skip malformed chunks
			}
		}
	}

	// ── Streaming Completion (for inline) ────────────────────────────
	async *streamCompletion(
		prompt: string,
		suffix?: string,
		model?: string,
		cancellation?: vscode.CancellationToken
	): AsyncIterable<string> {
		const body = JSON.stringify({
			model: model ?? this.model,
			prompt,
			suffix: suffix ?? '',
			stream: true,
			options: {
				num_predict: 128,
				temperature: 0.2,
				top_p: 0.9,
				stop: ['\n\n', '\r\n\r\n']
			}
		});

		const chunks = this.streamRequest('POST', '/api/generate', body, cancellation);

		for await (const chunk of chunks) {
			try {
				const parsed: OllamaGenerateResponse = JSON.parse(chunk);
				if (parsed.response) {
					yield parsed.response;
				}
				if (parsed.done) {
					return;
				}
			} catch {
				// Skip malformed chunks
			}
		}
	}

	// ── Single-shot completion (non-streaming) ───────────────────────
	async complete(prompt: string, suffix?: string, model?: string): Promise<string> {
		const parts: string[] = [];
		for await (const part of this.streamCompletion(prompt, suffix, model)) {
			parts.push(part);
		}
		return parts.join('');
	}

	// ── HTTP Helpers ─────────────────────────────────────────────────
	private request(method: string, path: string, body?: string): Promise<http.IncomingMessage> {
		return new Promise((resolve, reject) => {
			const url = new URL(path, this.endpoint);
			const isHttps = url.protocol === 'https:';
			const lib = isHttps ? https : http;

			const req = lib.request({
				hostname: url.hostname,
				port: url.port,
				path: url.pathname,
				method,
				headers: {
					'Content-Type': 'application/json',
					...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
				},
				timeout: 5000
			}, resolve);

			req.on('error', reject);
			req.on('timeout', () => {
				req.destroy();
				reject(new Error('Ollama request timeout'));
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
