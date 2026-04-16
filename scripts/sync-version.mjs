import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PKG_PATH = path.join(ROOT, 'apps/desktop/package.json');
const TAURI_CONF_PATH = path.join(ROOT, 'apps/desktop/src-tauri/tauri.conf.json');
const CARGO_PATH = path.join(ROOT, 'apps/desktop/src-tauri/Cargo.toml');

try {
  // Read package.json
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const version = pkg.version;

  let changed = false;

  // Sync tauri.conf.json
  const tauriConf = JSON.parse(fs.readFileSync(TAURI_CONF_PATH, 'utf-8'));

  if (tauriConf.version !== version) {
    console.log(`Syncing tauri.conf.json: ${tauriConf.version} -> ${version}`);
    tauriConf.version = version;
    fs.writeFileSync(TAURI_CONF_PATH, JSON.stringify(tauriConf, null, 2) + '\n');
    changed = true;
  }

  // Sync Cargo.toml
  let cargoContent = fs.readFileSync(CARGO_PATH, 'utf-8');
  const cargoVersionRegex = /^version\s*=\s*"([^"]*)"/m;
  const match = cargoContent.match(cargoVersionRegex);

  if (match && match[1] !== version) {
    console.log(`Syncing Cargo.toml: ${match[1]} -> ${version}`);
    cargoContent = cargoContent.replace(cargoVersionRegex, `version = "${version}"`);
    fs.writeFileSync(CARGO_PATH, cargoContent, 'utf-8');
    changed = true;
  }

  if (changed) {
    console.log('✅ Versions synced successfully.');
  } else {
    console.log('✨ Versions already match.');
  }
} catch (err) {
  console.error('❌ Failed to sync versions:', err.message);
  process.exit(1);
}

