const fs = require('fs');
const path = require('path');

const filesToUpdate = [
	'src/vs/workbench/contrib/chat/browser/widget/input/chatModelPicker.ts',
	'src/vs/workbench/api/common/extHostLanguageModels.ts',
	'src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts',
	'src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupProviders.ts',
	'src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupGrowthSession.ts',
	'src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupRunner.ts',
	'src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupController.ts',
	'src/vs/workbench/contrib/chat/common/participants/chatAgents.ts',
	'src/vs/workbench/contrib/chat/browser/chatManagement/chatModelsWidget.ts',
	'src/vs/workbench/contrib/chat/browser/chatSlashCommands.ts',
	'src/vs/workbench/contrib/chat/browser/widget/chatArtifactsWidget.ts',
	'src/vs/workbench/contrib/terminalContrib/chatAgentTools/common/terminalChatAgentToolsConfiguration.ts',
	'src/vs/workbench/contrib/terminal/browser/terminalMenus.ts',
	'src/vs/editor/contrib/inlineCompletions/browser/model/renameSymbolProcessor.ts',
	'src/vs/workbench/contrib/chat/common/promptSyntax/promptTypes.ts',
	'src/vs/workbench/contrib/chat/common/promptSyntax/config/config.ts',
	'src/vs/workbench/contrib/preferences/browser/settingsLayout.ts',
	'src/vs/workbench/contrib/editTelemetry/browser/telemetry/editSourceTrackingFeature.ts',
	'src/vs/workbench/contrib/editTelemetry/browser/telemetry/editSourceTrackingImpl.ts',
	'src/vs/workbench/contrib/chat/browser/widget/input/editor/chatInputCompletions.ts',
	'src/vs/workbench/contrib/chat/browser/aiCustomization/mcpListWidget.ts',
	'src/vs/workbench/contrib/chat/browser/aiCustomization/aiCustomizationListWidgetUtils.ts',
	'src/vs/sessions/contrib/copilotChatSessions/browser/copilotChatSessionsProvider.ts',
	'src/vs/sessions/contrib/copilotChatSessions/browser/isolationPicker.ts',
	'src/vs/sessions/contrib/copilotChatSessions/browser/copilotChatSessionsActions.ts',
	'src/vs/sessions/contrib/copilotChatSessions/browser/copilotChatSessions.contribution.ts',
	'src/vs/sessions/contrib/chat/browser/aiCustomizationWorkspaceService.ts',
	'src/vs/sessions/contrib/chat/browser/repoPicker.ts',
	'src/vs/platform/product/common/product.ts',
	'src/vs/platform/extensionManagement/common/abstractExtensionManagementService.ts',
	'src/vs/platform/dataChannel/browser/forwardingTelemetryService.ts'
];

for (const relPath of filesToUpdate) {
	const absolutePath = path.join('e:/proyects/trixty-ide', relPath);
	if (!fs.existsSync(absolutePath)) {
		console.warn('Skipping missing file:', absolutePath);
		continue;
	}

	let content = fs.readFileSync(absolutePath, 'utf8');
	let original = content;

	// vendor checks
	content = content.replace(/vendor === 'copilot'/g, "vendor === 'trixty'");
	content = content.replace(/vendor === \"copilot\"/g, "vendor === \"trixty\"");

	// string replacements
	content = content.replace(/Use AI Features with Copilot for free.../g, "Use AI Features with Trixty AI...");
	content = content.replace(/Upgrade to GitHub Copilot Pro/g, "Upgrade Trixty AI Plan");
	content = content.replace(/Manage GitHub Copilot Overages/g, "Manage Trixty AI Usage");
	content = content.replace(/github.copilot.chat.explain/g, "trixty.ai.chat.explain");
	content = content.replace(/github.copilot.chat.fix/g, "trixty.ai.chat.fix");
	content = content.replace(/github.copilot.chat.review/g, "trixty.ai.chat.review");
	content = content.replace(/github.copilot.chat.codeReview.run/g, "trixty.ai.chat.codeReview.run");
	content = content.replace(/group: '2_copilot'/g, "group: '2_trixty'");
	
	content = content.replace(/You need to set up GitHub Copilot/g, "You need to set up Trixty AI");
	content = content.replace(/GitHub Copilot is available\. Try it for free\./g, "Trixty AI is available.");
	content = content.replace(/Tell me about GitHub Copilot!/g, "Tell me about Trixty AI!");
	content = content.replace(/Welcome to GitHub Copilot/g, "Welcome to Trixty AI");
	content = content.replace(/tool\.id\.startsWith\('copilot_'\)/g, "tool.id.startsWith('trixty_')");
	content = content.replace(/\.append\('copilot'\)/g, ".append('trixty')");
	content = content.replace(/defaultChat\.provider\.default\.name\} Copilot/g, "defaultChat.provider.default.name} AI");
	
	content = content.replace(/Try Copilot/g, "Try Trixty AI");
	
	content = content.replace(/copilot\.setup/g, "trixty.setup");
	
	// IDs and object paths
	content = content.replace(/GitHub\.copilot/g, "Trixty.trixty-ai");
	content = content.replace(/github\.copilot/g, "trixty.ai");
	content = content.replace(/chat\.internal\.explain/g, "chat.internal.explain"); // retain
	
	content = content.replace(/copilot_`/g, "trixty_`");
	content = content.replace(/copilot_/g, "trixty_");

	if (content !== original) {
		fs.writeFileSync(absolutePath, content, 'utf8');
		console.log('Updated:', relPath);
	}
}
