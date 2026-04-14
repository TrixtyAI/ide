/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Trixty. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAssignmentService } from '../../../../platform/assignment/common/assignment.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

export interface IAssignmentFilter {
	exclude(assignment: string): boolean;
	onDidChange: Event<void>;
}

export const IWorkbenchAssignmentService = createDecorator<IWorkbenchAssignmentService>('assignmentService');

export interface IWorkbenchAssignmentService extends IAssignmentService {
	getCurrentExperiments(): Promise<string[] | undefined>;
	addTelemetryAssignmentFilter(filter: IAssignmentFilter): void;
}

export class WorkbenchAssignmentService extends Disposable implements IWorkbenchAssignmentService {
	declare readonly _serviceBrand: undefined;
	public readonly onDidRefetchAssignments = Event.None;

	async getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined> {
		return undefined;
	}

	async getCurrentExperiments(): Promise<string[] | undefined> {
		return undefined;
	}

	addTelemetryAssignmentFilter(filter: IAssignmentFilter): void {
		// Null implementation
	}
}

registerSingleton(IWorkbenchAssignmentService, WorkbenchAssignmentService, InstantiationType.Delayed);
