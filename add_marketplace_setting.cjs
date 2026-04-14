const fs = require('fs');
const path = require('path');

const extensionsContributionPath = path.join('e:/proyects/trixty-ide/src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts');
if (fs.existsSync(extensionsContributionPath)) {
	let content = fs.readFileSync(extensionsContributionPath, 'utf8');
	if (!content.includes('trixtyIDE.marketplace')) {
		content = content.replace(/'properties': {/, "'properties': {\n\t\t'trixtyIDE.marketplace': {\n\t\t\ttype: 'string',\n\t\t\tenum: ['openvsx', 'vscode'],\n\t\t\tdefault: 'openvsx',\n\t\t\tdescription: 'Select the marketplace to use for extensions. Require restart.',\n\t\t}, ");
		fs.writeFileSync(extensionsContributionPath, content, 'utf8');
		console.log('Registered trixtyIDE.marketplace setting');
	}
}
