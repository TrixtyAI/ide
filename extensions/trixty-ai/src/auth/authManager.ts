/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Trixty. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const TRIXTY_API_KEY_SECRET = 'trixty.ai.apiKey';
const TRIXTY_USER_DATA_KEY = 'trixty.ai.userData';

interface TrixtyUserData {
	username: string;
	balance: number;
	signedInAt: number;
}

export class TrixtyAuthManager {
	private readonly context: vscode.ExtensionContext;
	private readonly outputChannel: vscode.LogOutputChannel;
	private userData: TrixtyUserData | null = null;

	constructor(context: vscode.ExtensionContext, outputChannel: vscode.LogOutputChannel) {
		this.context = context;
		this.outputChannel = outputChannel;

		// Restore cached user data
		const cached = context.globalState.get<TrixtyUserData>(TRIXTY_USER_DATA_KEY);
		if (cached) {
			this.userData = cached;
		}
	}

	get isSignedIn(): boolean {
		return this.userData !== null && !!this.getApiKey();
	}

	getApiKey(): string | undefined {
		// First try secret storage, then fall back to settings
		const settingsKey = vscode.workspace.getConfiguration('trixtyAI').get<string>('trixty.apiKey');
		return settingsKey || undefined;
	}

	// ── Sign In Flow ─────────────────────────────────────────────────
	async signIn(): Promise<boolean> {
		this.outputChannel.info('Starting Trixty AI sign-in flow...');

		const apiKey = await vscode.window.showInputBox({
			title: 'Sign In to Trixty AI',
			prompt: 'Enter your Trixty AI API Key (from trixty.dev/settings)',
			password: true,
			placeHolder: 'trx_xxxxxxxxxxxxxxxxxxxxxxxx',
			ignoreFocusOut: true,
			validateInput: (value) => {
				if (!value || value.trim().length < 10) {
					return 'API key must be at least 10 characters';
				}
				return null;
			}
		});

		if (!apiKey) {
			this.outputChannel.info('Sign-in cancelled by user');
			return false;
		}

		// Store API key in settings
		await vscode.workspace.getConfiguration('trixtyAI').update(
			'trixty.apiKey',
			apiKey.trim(),
			vscode.ConfigurationTarget.Global
		);

		// Validate key against /cli/init
		try {
			const endpoint = vscode.workspace.getConfiguration('trixtyAI').get<string>('trixty.endpoint', 'http://localhost:3000/api/v1');
			const response = await fetch(`${endpoint}/cli/init`, {
				headers: {
					'Authorization': `Bearer ${apiKey.trim()}`
				}
			});

			if (response.ok) {
				const data = await response.json() as { balance: number; models: string[] };
				this.userData = {
					username: 'Trixty User',
					balance: data.balance ?? 0,
					signedInAt: Date.now()
				};
				await this.context.globalState.update(TRIXTY_USER_DATA_KEY, this.userData);
				this.outputChannel.info(`Signed in successfully. Balance: ${this.userData.balance}. Models: ${data.models?.length ?? 0}`);
				vscode.window.showInformationMessage(`Trixty AI: Signed in successfully! Balance: ${this.userData.balance}`);
				return true;
			} else {
				this.outputChannel.error(`Sign-in failed: HTTP ${response.status}`);
				vscode.window.showErrorMessage(`Trixty AI: Sign-in failed (${response.status}). Check your API key.`);
				// Clear the invalid key
				await vscode.workspace.getConfiguration('trixtyAI').update(
					'trixty.apiKey',
					'',
					vscode.ConfigurationTarget.Global
				);
				return false;
			}
		} catch (error) {
			this.outputChannel.error('Sign-in network error:', String(error));
			// Store key anyway — server might be offline but key could be valid
			this.userData = {
				username: 'Trixty User',
				balance: 0,
				signedInAt: Date.now()
			};
			await this.context.globalState.update(TRIXTY_USER_DATA_KEY, this.userData);
			vscode.window.showWarningMessage('Trixty AI: Could not verify API key (server unreachable). Key saved for later use.');
			return true;
		}
	}

	// ── Sign Out ─────────────────────────────────────────────────────
	async signOut(): Promise<void> {
		this.outputChannel.info('Signing out from Trixty AI...');
		this.userData = null;
		await vscode.workspace.getConfiguration('trixtyAI').update(
			'trixty.apiKey',
			'',
			vscode.ConfigurationTarget.Global
		);
		await this.context.globalState.update(TRIXTY_USER_DATA_KEY, undefined);
		vscode.window.showInformationMessage('Trixty AI: Signed out.');
	}

	// ── Refresh Token (re-validate) ──────────────────────────────────
	async refreshToken(): Promise<void> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			vscode.window.showWarningMessage('Trixty AI: Not signed in. Please sign in first.');
			return;
		}

		try {
			const endpoint = vscode.workspace.getConfiguration('trixtyAI').get<string>('trixty.endpoint', 'http://localhost:3000/api/v1');
			const response = await fetch(`${endpoint}/cli/init`, {
				headers: { 'Authorization': `Bearer ${apiKey}` }
			});

			if (response.ok) {
				const data = await response.json() as { balance: number };
				if (this.userData) {
					this.userData.balance = data.balance ?? 0;
					await this.context.globalState.update(TRIXTY_USER_DATA_KEY, this.userData);
				}
				this.outputChannel.info('Token refreshed. Balance: ' + (data.balance ?? 0));
			} else {
				this.outputChannel.warn(`Token refresh failed: HTTP ${response.status}`);
			}
		} catch (error) {
			this.outputChannel.error('Token refresh error:', String(error));
		}
	}

	getUserBalance(): number {
		return this.userData?.balance ?? 0;
	}
}
