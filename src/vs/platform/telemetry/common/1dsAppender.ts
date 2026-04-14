/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mixin } from '../../../base/common/objects.js';
import { ITelemetryAppender, validateTelemetryData } from './telemetryUtils.js';

export interface IAppInsightsCore {
	pluginVersionString: string;
	track(item: any): void;
	unload(isAsync: boolean, unloadComplete: (unloadState: any) => void): void;
}

export abstract class AbstractOneDataSystemAppender implements ITelemetryAppender {
	protected _aiCoreOrKey: any;
	protected readonly endPointUrl = '';
	protected readonly endPointHealthUrl = '';

	constructor(
		private readonly _isInternalTelemetry: boolean,
		private _eventPrefix: string,
		private _defaultData: { [key: string]: unknown } | null,
		iKeyOrClientFactory: string | (() => IAppInsightsCore),
		private _xhrOverride?: any
	) {
		if (!this._defaultData) {
			this._defaultData = {};
		}
	}

	log(eventName: string, data?: unknown): void {
		// Null implementation (Trixty telemetry removal)
	}

	flush(): Promise<void> {
		return Promise.resolve(undefined);
	}
}
