import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import prompts from 'prompts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'apps/desktop/package.json');

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  return pkg.version;
}

function parseVersion(v) {
  return v.split('.').map(Number);
}

function isGreater(v1, v2) {
  const [major1, minor1, patch1] = parseVersion(v1);
  const [major2, minor2, patch2] = parseVersion(v2);

  if (major1 > major2) return true;
  if (major1 < major2) return false;
  if (minor1 > minor2) return true;
  if (minor1 < minor2) return false;
  return patch1 > patch2;
}

function incrementVersion(version, type) {
  let [major, minor, patch] = parseVersion(version);

  switch (type) {
    case 'major':
      major++;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor++;
      patch = 0;
      break;
    case 'patch':
      patch++;
      break;
    default:
      if (type.includes('.')) {
        if (!isGreater(type, version)) {
          throw new Error(`Nueva versión ${type} no puede ser menor o igual a la actual ${version}`);
        }
        return type;
      }
      throw new Error('Tipo de incremento inválido. Usar: major, minor, patch o versión específica (e.g. 1.2.3)');
  }

  return `${major}.${minor}.${patch}`;
}

async function run() {
  let type = process.argv[2];

  if (!type) {
    const currentVersion = getVersion();
    const nextPatch = incrementVersion(currentVersion, 'patch');
    const nextMinor = incrementVersion(currentVersion, 'minor');
    const nextMajor = incrementVersion(currentVersion, 'major');

    const response = await prompts({
      type: 'select',
      name: 'value',
      message: `Selecciona el tipo de incremento (actual: v${currentVersion})`,
      choices: [
        { title: `Patch (v${nextPatch})`, value: 'patch' },
        { title: `Minor (v${nextMinor})`, value: 'minor' },
        { title: `Major (v${nextMajor})`, value: 'major' },
        { title: 'Versión personalizada', value: 'custom' },
        { title: 'Cancelar', value: 'cancel' }
      ],
      initial: 0
    });

    if (!response.value || response.value === 'cancel') {
      console.log('Operación cancelada.');
      process.exit(0);
    }

    if (response.value === 'custom') {
      const customResponse = await prompts({
        type: 'text',
        name: 'value',
        message: 'Ingresa la nueva versión:',
        validate: value => /^\d+\.\d+\.\d+$/.test(value) ? true : 'Formato inválido (ej: 1.2.3)'
      });
      
      if (!customResponse.value) {
        console.log('Operación cancelada.');
        process.exit(0);
      }
      type = customResponse.value;
    } else {
      type = response.value;
    }
  }

  try {
    const currentVersion = getVersion();
    const nextVersion = incrementVersion(currentVersion, type);

    console.log(`🚀 Incrementando versión: ${currentVersion} -> ${nextVersion}`);

    // 1. Update apps/desktop/package.json
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
    pkg.version = nextVersion;
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

    // 2. Sync other files
    console.log('🔄 Sincronizando archivos...');
    execSync('node scripts/sync-version.mjs', { stdio: 'inherit' });

    // 3. Git operations
    console.log('📦 Commiteando y tagueando...');
    execSync('git add .', { stdio: 'inherit' });
    execSync(`git commit -m "chore: release v${nextVersion}"`, { stdio: 'inherit' });
    execSync(`git tag v${nextVersion}`, { stdio: 'inherit' });

    console.log('📤 Pusheando a GitHub...');
    execSync('git push origin main', { stdio: 'inherit' });
    execSync(`git push origin v${nextVersion}`, { stdio: 'inherit' });

    console.log(`✅ Publicado con éxito: v${nextVersion}`);
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

run();
