/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Trixty. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';

export class CopilotAssignmentFilterProvider extends Disposable {
	private readonly _onDidChangeFilters = this._register(new Emitter<void>());
	readonly onDidChangeFilters = this._onDidChangeFilters.event;

	constructor() {
		super();
	}

	getFilterValue(filter: string): string | null {
		return null;
	}

	getFilters(): Map<string, string | null> {
		return new Map<string, string | null>();
	}
}
