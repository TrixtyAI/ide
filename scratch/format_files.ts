import fs from 'fs';
import path from 'path';
import { format } from '../build/lib/formatter.ts';

const files = process.argv.slice(2);

for (const file of files) {
	const absolutePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
	if (fs.existsSync(absolutePath)) {
		console.log(`Formatting ${file}...`);
		const content = fs.readFileSync(absolutePath, 'utf8');
		const formatted = format(absolutePath, content);
		if (content !== formatted) {
			fs.writeFileSync(absolutePath, formatted);
			console.log(`  Done.`);
		} else {
			console.log(`  Already formatted.`);
		}
	} else {
		console.error(`File not found: ${file}`);
	}
}
