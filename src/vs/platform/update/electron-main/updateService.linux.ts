/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, UpdateType } from '../common/update.js';
import { AbstractUpdateService, createUpdateURL, IUpdateURLOptions } from './abstractUpdateService.js';

export class LinuxUpdateService extends AbstractUpdateService {

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
		@IProductService productService: IProductService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, false);
	}

	protected buildUpdateFeedUrl(quality: string, commit: string, options?: IUpdateURLOptions): string {
		return createUpdateURL(this.productService.updateUrl!, `linux-${process.arch}`, quality, commit, options);
	}

	protected doCheckForUpdates(explicit: boolean, _pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}

		const internalOrg = this.getInternalOrg();
		const background = false;
		let url = this.productService.githubUpdateRepo ? `https://api.github.com/repos/${this.productService.githubUpdateRepo}/releases/latest` : this.buildUpdateFeedUrl(this.quality, this.productService.commit!, { background, internalOrg });
		this.setState(State.CheckingForUpdates(explicit));

		let headers: Record<string, string> = {};
		if (this.productService.githubUpdateToken) {
			headers['Authorization'] = `Bearer ${this.productService.githubUpdateToken}`;
			headers['Accept'] = 'application/vnd.github.v3+json';
		}

		this.requestService.request({ url, headers, callSite: 'updateService.linux.checkForUpdates' }, CancellationToken.None)
			.then<any>(asJson)
			.then(githubRelease => {
				if (!githubRelease) {
					this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
					return;
				}

				let version = githubRelease.tag_name ? githubRelease.tag_name.replace(/^v/, '') : githubRelease.version;
				if (!version || this.productService.version === version) {
					this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
					return;
				}

				const assets = githubRelease.assets || [];
				let linuxAsset = assets.find((a: any) => a.name.endsWith('.tar.gz') || a.name.endsWith('.deb') || a.name.endsWith('.rpm'));
				
				const update: IUpdate = {
					version: version,
					productVersion: version,
					url: linuxAsset ? linuxAsset.url : (githubRelease.html_url || githubRelease.url)
				};

				this.setState(State.AvailableForDownload(update));
			})
			.then(undefined, err => {
				if (err && (err.status === 401 || err.status === 403 || (err.message && err.message.includes('401')))) {
					const message = "La sincronizacion de actualizaciones automaticas se desactivo forzosamente. Se requiere actualizar manualmente a la ultima version, si sigues precentando este problema informalo en un issue.";
					this.logService.error('update#githubAuthError: Token might be expired', err);
					this.setState(State.Idle(UpdateType.Archive, message));
					return;
				}
				this.logService.error(err);
				// only show message when explicitly checking for updates
				const message: string | undefined = explicit ? (err.message || err) : undefined;
				this.setState(State.Idle(UpdateType.Archive, message));
			});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// Use the download URL if available as we don't currently detect the package type that was
		// installed and the website download page is more useful than the tarball generally.
		if (this.productService.downloadUrl && this.productService.downloadUrl.length > 0) {
			this.nativeHostMainService.openExternal(undefined, this.productService.downloadUrl);
		} else if (state.update.url) {
			this.nativeHostMainService.openExternal(undefined, state.update.url);
		}

		this.setState(State.Idle(UpdateType.Archive));
	}
}
