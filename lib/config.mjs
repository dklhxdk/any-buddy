import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const OUR_CONFIG = join(homedir(), '.claude-code-any-buddy.json');

// Read the user's Claude userId from ~/.claude.json
export function getClaudeUserId() {
  const paths = [
    join(homedir(), '.claude.json'),
    join(homedir(), '.claude', '.config.json'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const config = JSON.parse(readFileSync(p, 'utf-8'));
        return config.oauthAccount?.accountUuid ?? config.userID ?? 'anon';
      } catch {
        continue;
      }
    }
  }

  return 'anon';
}

// Save our pet config
export function savePetConfig(data) {
  writeFileSync(OUR_CONFIG, JSON.stringify(data, null, 2) + '\n');
}

// Load our pet config
export function loadPetConfig() {
  if (!existsSync(OUR_CONFIG)) return null;
  try {
    return JSON.parse(readFileSync(OUR_CONFIG, 'utf-8'));
  } catch {
    return null;
  }
}

// Get the path to ~/.claude.json
function getClaudeConfigPath() {
  const paths = [
    join(homedir(), '.claude.json'),
    join(homedir(), '.claude', '.config.json'),
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return paths[0]; // default
}

// Read the companion's current name from ~/.claude.json
export function getCompanionName() {
  const configPath = getClaudeConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return config.companion?.name ?? null;
  } catch {
    return null;
  }
}

// Rename the companion in ~/.claude.json
export function renameCompanion(newName) {
  const configPath = getClaudeConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(`Claude config not found at ${configPath}`);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (!config.companion) {
    throw new Error('No companion found in config. Run /buddy in Claude Code first to hatch one.');
  }
  config.companion.name = newName;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

// Read the companion's personality from ~/.claude.json
export function getCompanionPersonality() {
  const configPath = getClaudeConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return config.companion?.personality ?? null;
  } catch {
    return null;
  }
}

// Update the companion's personality in ~/.claude.json
export function setCompanionPersonality(personality) {
  const configPath = getClaudeConfigPath();
  if (!existsSync(configPath)) {
    throw new Error(`Claude config not found at ${configPath}`);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (!config.companion) {
    throw new Error('No companion found in config. Run /buddy in Claude Code first to hatch one.');
  }
  config.companion.personality = personality;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

// Read or write Claude Code's settings.json for hooks
const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

export function getClaudeSettings() {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveClaudeSettings(settings) {
  const dir = join(homedir(), '.claude');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

const HOOK_COMMAND = 'claude-code-any-buddy apply --silent';

export function isHookInstalled() {
  const settings = getClaudeSettings();
  const hooks = settings.hooks?.SessionStart;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(h => h.command === HOOK_COMMAND);
}

export function installHook() {
  const settings = getClaudeSettings();
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];

  if (!settings.hooks.SessionStart.some(h => h.command === HOOK_COMMAND)) {
    settings.hooks.SessionStart.push({
      type: 'command',
      command: HOOK_COMMAND,
    });
  }

  saveClaudeSettings(settings);
}

export function removeHook() {
  const settings = getClaudeSettings();
  if (!settings.hooks?.SessionStart) return;
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
    h => h.command !== HOOK_COMMAND
  );
  if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  saveClaudeSettings(settings);
}
