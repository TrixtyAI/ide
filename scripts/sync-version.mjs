import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PKG_PATH = path.join(ROOT, 'apps/desktop/package.json');
const TAURI_CONF_PATH = path.join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json');

try {
  // Read package.json
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const version = pkg.version;

  // Read tauri.conf.json
  const tauriConf = JSON.parse(fs.readFileSync(TAURI_CONF_PATH, 'utf-8'));

  if (tauriConf.version !== version) {
    console.log(`Syncing version: ${tauriConf.version} -> ${version}`);
    tauriConf.version = version;

    // Write back with 2 spaces indentation
    fs.writeFileSync(TAURI_CONF_PATH, JSON.stringify(tauriConf, null, 2) + '\n');
    console.log('✅ Version synced successfully.');
  } else {
    console.log('✨ Versions already match.');
  }
} catch (err) {
  console.error('❌ Failed to sync versions:', err.message);
  process.exit(1);
}
