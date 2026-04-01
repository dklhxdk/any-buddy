import { select, confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import { SPECIES, EYES, HATS, RARITIES, RARITY_STARS, RARITY_WEIGHTS, STAT_NAMES, ORIGINAL_SALT } from './constants.mjs';
import { roll } from './generation.mjs';
import { renderSprite, renderFace } from './sprites.mjs';
import { findSalt } from './finder.mjs';
import { findClaudeBinary, getCurrentSalt, patchBinary, verifySalt, restoreBinary, isClaudeRunning } from './patcher.mjs';
import { getClaudeUserId, savePetConfig, loadPetConfig, isHookInstalled, installHook, removeHook, getCompanionName, renameCompanion, getCompanionPersonality, setCompanionPersonality } from './config.mjs';
import { DEFAULT_PERSONALITIES } from './personalities.mjs';

const RARITY_CHALK = {
  common: chalk.gray,
  uncommon: chalk.green,
  rare: chalk.blue,
  epic: chalk.magenta,
  legendary: chalk.yellow,
};

function formatSprite(bones, frame = 0) {
  return renderSprite(bones, frame).join('\n');
}

function spritePreview(species, eye, hat, rarity) {
  const bones = { species, eye, hat: rarity === 'common' ? 'none' : hat, rarity, shiny: false, stats: {} };
  const lines = renderSprite(bones, 0);
  return lines.map(l => l.trimEnd()).join('\n');
}

function colorize(text, rarity) {
  return (RARITY_CHALK[rarity] || chalk.white)(text);
}

function banner() {
  console.log(chalk.bold('\n  claude-code-any-buddy'));
  console.log(chalk.dim('  Pick any Claude Code companion pet\n'));
}

function showPet(bones, label = 'Your pet') {
  const rarityColor = RARITY_CHALK[bones.rarity] || chalk.white;
  console.log(rarityColor(`\n  ${label}: ${bones.species} ${RARITY_STARS[bones.rarity]}`));
  let info = `  Rarity: ${bones.rarity}  Eyes: ${bones.eye}  Hat: ${bones.hat}  Shiny: ${bones.shiny ? 'YES' : 'no'}`;
  if (bones.stats && Object.keys(bones.stats).length) {
    const sorted = Object.entries(bones.stats).sort((a, b) => b[1] - a[1]);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    info += `\n  Best: ${best[0]} ${best[1]}  Worst: ${worst[0]} ${worst[1]}`;
  }
  console.log(rarityColor(info));
  const lines = renderSprite(bones, 0);
  console.log();
  for (const line of lines) {
    console.log(rarityColor('    ' + line));
  }
  console.log();
}

// ─── Subcommands ───

export async function runCurrent() {
  banner();
  const userId = getClaudeUserId();
  console.log(chalk.dim(`  User ID: ${userId.slice(0, 12)}...`));

  // Show what the original salt produces
  const origResult = roll(userId, ORIGINAL_SALT);
  showPet(origResult.bones, 'Default pet (original salt)');

  // Show patched pet if applicable
  const config = loadPetConfig();
  if (config?.salt && config.salt !== ORIGINAL_SALT) {
    const patchedResult = roll(userId, config.salt);
    showPet(patchedResult.bones, 'Active pet (patched)');
  }
}

export async function runPreview(flags = {}) {
  banner();

  const species = validateFlag('species', flags.species, SPECIES) ?? await selectSpecies();
  const eye = validateFlag('eye', flags.eye, EYES) ?? await selectEyes(species);
  const rarity = validateFlag('rarity', flags.rarity, RARITIES) ?? await selectRarity();
  const hat = rarity === 'common' ? 'none'
    : validateFlag('hat', flags.hat, HATS) ?? await selectHat(species, eye, rarity);

  const shiny = flags.shiny ?? false;
  const bones = { species, eye, hat, rarity, shiny, stats: {} };
  showPet(bones, 'Preview');
  console.log(chalk.dim('  (Preview only - no changes made)\n'));
}

export async function runApply({ silent = false } = {}) {
  const config = loadPetConfig();
  if (!config?.salt) {
    if (!silent) console.error('No saved pet config. Run claude-code-any-buddy first.');
    process.exit(silent ? 0 : 1);
  }

  let binaryPath;
  try {
    binaryPath = findClaudeBinary();
  } catch (err) {
    if (!silent) console.error(err.message);
    process.exit(silent ? 0 : 1);
  }

  // Check if already patched with our salt
  const check = verifySalt(binaryPath, config.salt);
  if (check.found >= 3) {
    if (!silent) console.log(chalk.green('  Pet already applied.'));
    return;
  }

  // Find what salt is currently in the binary
  const current = getCurrentSalt(binaryPath);
  const oldSalt = current.patched ? null : ORIGINAL_SALT;

  if (!oldSalt) {
    // Binary has unknown salt — check if it's a previous any-buddy salt
    // Try to find the salt from our config's previous application
    if (config.previousSalt) {
      const prevCheck = verifySalt(binaryPath, config.previousSalt);
      if (prevCheck.found >= 3) {
        const result = patchBinary(binaryPath, config.previousSalt, config.salt);
        if (!silent) console.log(chalk.green(`  Re-patched (${result.replacements} replacements).`));
        return;
      }
    }
    // Try original salt as fallback (maybe Claude updated)
    const origCheck = verifySalt(binaryPath, ORIGINAL_SALT);
    if (origCheck.found >= 3) {
      const result = patchBinary(binaryPath, ORIGINAL_SALT, config.salt);
      if (!silent) console.log(chalk.green(`  Patched after update (${result.replacements} replacements).`));
      return;
    }
    if (!silent) console.error('Could not find known salt in binary. Claude Code may have changed the salt string.');
    process.exit(silent ? 0 : 1);
  }

  const result = patchBinary(binaryPath, oldSalt, config.salt);
  if (!silent) {
    console.log(chalk.green(`  Applied (${result.replacements} replacements).`));
    if (isClaudeRunning(binaryPath)) {
      console.log(chalk.yellow('  Restart Claude Code for the change to take effect.'));
    }
  }
}

export async function runRestore() {
  banner();
  const binaryPath = findClaudeBinary();

  const config = loadPetConfig();
  if (config?.salt && config.salt !== ORIGINAL_SALT) {
    // Try to patch back to original
    const check = verifySalt(binaryPath, config.salt);
    if (check.found >= 3) {
      patchBinary(binaryPath, config.salt, ORIGINAL_SALT);
      console.log(chalk.green('  Restored original pet salt.'));
    } else {
      // Try backup
      try {
        restoreBinary(binaryPath);
        console.log(chalk.green('  Restored from backup.'));
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
    }
  } else {
    console.log(chalk.dim('  Already using original salt.'));
  }

  // Clean up hook if installed
  if (isHookInstalled()) {
    removeHook();
    console.log(chalk.dim('  Removed SessionStart hook.'));
  }

  // Remove our config
  savePetConfig({ salt: ORIGINAL_SALT, restored: true });
  console.log();
}

export async function runInteractive(flags = {}) {
  banner();

  const userId = getClaudeUserId();
  if (userId === 'anon') {
    console.log(chalk.yellow('  Warning: No Claude Code user ID found. Using "anon".'));
    console.log(chalk.yellow('  Make sure Claude Code is installed and you\'ve logged in.\n'));
  } else {
    console.log(chalk.dim(`  User ID: ${userId.slice(0, 12)}...\n`));
  }

  // Show current pet
  const currentBones = roll(userId, ORIGINAL_SALT).bones;
  showPet(currentBones, 'Your current default pet');

  // Check if already patched
  const existingConfig = loadPetConfig();
  if (existingConfig?.salt && existingConfig.salt !== ORIGINAL_SALT) {
    const patchedBones = roll(userId, existingConfig.salt).bones;
    showPet(patchedBones, 'Your active patched pet');
  }

  // ─── Selection flow ───
  console.log(chalk.bold('  Choose your new pet:\n'));

  // Use flags if provided, otherwise prompt interactively
  const species = validateFlag('species', flags.species, SPECIES) ?? await selectSpecies();
  const eye = validateFlag('eye', flags.eye, EYES) ?? await selectEyes(species);
  const rarity = validateFlag('rarity', flags.rarity, RARITIES) ?? await selectRarity();
  const hat = rarity === 'common' ? 'none'
    : validateFlag('hat', flags.hat, HATS) ?? await selectHat(species, eye, rarity);
  const shiny = flags.shiny ?? await confirm({
    message: 'Shiny? (1% normally — search takes ~100x longer)',
    default: false,
  });
  const wantStats = flags.peak || flags.dump || await confirm({
    message: 'Customize stats? (best/worst stat — search takes ~20x longer)',
    default: false,
  });
  let peak = null, dump = null;
  if (wantStats) {
    peak = validateFlag('peak', flags.peak, STAT_NAMES) ?? await selectStat('Best stat');
    dump = validateFlag('dump', flags.dump, STAT_NAMES) ?? await selectStat('Worst stat', peak);
  }

  // Final preview
  const desired = { species, eye, hat, rarity, shiny, peak, dump };
  const previewBones = { ...desired, stats: {} };
  showPet(previewBones, 'Your selection');

  const proceed = flags.yes || await confirm({
    message: 'Find a matching salt and apply?',
    default: true,
  });

  if (!proceed) {
    console.log(chalk.dim('\n  Cancelled.\n'));
    return;
  }

  // ─── Find salt ───
  console.log(chalk.dim('\n  Searching for matching salt...'));

  const result = findSalt(userId, desired, {
    onProgress: (attempts, ms) => {
      process.stdout.write(chalk.dim(`\r  Tried ${(attempts / 1000).toFixed(0)}k seeds (${(ms / 1000).toFixed(1)}s)...`));
    },
  });

  console.log(chalk.green(`\r  Found salt "${result.salt}" in ${result.attempts.toLocaleString()} attempts (${(result.elapsed / 1000).toFixed(1)}s)`));
  const foundBones = roll(userId, result.salt).bones;
  showPet(foundBones, 'Your new pet');

  // ─── Patch binary ───
  let binaryPath;
  try {
    binaryPath = findClaudeBinary();
  } catch (err) {
    console.error(chalk.red(`\n  ${err.message}`));
    console.log(chalk.dim(`  Salt saved. You can manually apply later with: claude-code-any-buddy apply\n`));
    savePetConfig({
      salt: result.salt,
      species: desired.species,
      rarity: desired.rarity,
      eye: desired.eye,
      hat: desired.hat,
      appliedAt: new Date().toISOString(),
    });
    return;
  }

  console.log(chalk.dim(`  Binary: ${binaryPath}`));

  // Find what's currently in the binary
  const current = getCurrentSalt(binaryPath);
  let oldSalt;
  if (!current.patched) {
    oldSalt = ORIGINAL_SALT;
  } else if (existingConfig?.salt) {
    oldSalt = existingConfig.salt;
    const check = verifySalt(binaryPath, oldSalt);
    if (check.found < 3) {
      console.error(chalk.red('  Cannot find current salt in binary. Try restoring first.'));
      return;
    }
  } else {
    console.error(chalk.red('  Binary appears patched but no previous salt on record. Try restoring first.'));
    return;
  }

  const running = isClaudeRunning(binaryPath);
  if (running) {
    console.log(chalk.yellow('\n  Claude Code is currently running.'));
    console.log(chalk.yellow('  The patch is safe (uses atomic rename — the running process'));
    console.log(chalk.yellow('  keeps using the old binary in memory), but the change won\'t'));
    console.log(chalk.yellow('  take effect until you restart Claude Code.\n'));
  }

  const applyNow = flags.yes || await confirm({
    message: running
      ? 'Patch binary? (you\'ll need to restart Claude Code after)'
      : 'Patch binary? (backup will be created)',
    default: true,
  });

  if (!applyNow) {
    savePetConfig({
      salt: result.salt,
      species: desired.species,
      rarity: desired.rarity,
      eye: desired.eye,
      hat: desired.hat,
      appliedAt: new Date().toISOString(),
    });
    console.log(chalk.dim('  Salt saved. Apply later with: claude-code-any-buddy apply\n'));
    return;
  }

  const patchResult = patchBinary(binaryPath, oldSalt, result.salt);
  console.log(chalk.green(`  Patched! ${patchResult.replacements} replacements, verified: ${patchResult.verified}`));
  console.log(chalk.dim(`  Backup: ${patchResult.backupPath}`));

  // Save config
  savePetConfig({
    salt: result.salt,
    previousSalt: oldSalt,
    species: desired.species,
    rarity: desired.rarity,
    eye: desired.eye,
    hat: desired.hat,
    appliedTo: binaryPath,
    appliedAt: new Date().toISOString(),
  });

  // ─── Hook setup ───
  if (!isHookInstalled() && !flags.noHook) {
    const setupHook = flags.yes || await confirm({
      message: 'Install SessionStart hook to auto-re-apply after updates?',
      default: true,
    });

    if (setupHook) {
      installHook();
      console.log(chalk.green('  Hook installed in ~/.claude/settings.json'));
    }
  } else if (isHookInstalled()) {
    console.log(chalk.dim('  SessionStart hook already installed.'));
  }

  // ─── Rename & Personality ───
  const currentName = getCompanionName();
  const currentPersonality = getCompanionPersonality();

  if (currentName) {
    const newName = flags.name ?? await input({
      message: `Rename your companion? (current: "${currentName}", leave blank to keep)`,
      default: '',
    });

    if (newName && newName !== currentName) {
      try {
        renameCompanion(newName);
        console.log(chalk.green(`  Renamed "${currentName}" → "${newName}"`));
      } catch (err) {
        console.log(chalk.yellow(`  Could not rename: ${err.message}`));
      }
    }
  } else if (flags.name) {
    console.log(chalk.dim('  No companion hatched yet — name will be set when you run /buddy'));
  }

  if (currentPersonality) {
    console.log(chalk.dim(`\n  Current personality: "${currentPersonality}"`));

    // Determine the species — use the desired species from the selection above
    const selectedSpecies = desired.species;
    const speciesDefault = DEFAULT_PERSONALITIES[selectedSpecies] || null;

    let newPersonality = flags.personality;
    if (!newPersonality) {
      const choices = [
        { name: 'Keep current', value: 'keep' },
      ];
      if (speciesDefault) {
        choices.push({ name: `Use ${selectedSpecies} default: "${speciesDefault.slice(0, 60)}..."`, value: 'default' });
      }
      choices.push({ name: 'Write custom', value: 'custom' });

      const choice = await select({ message: 'Personality', choices });

      if (choice === 'default') {
        newPersonality = speciesDefault;
      } else if (choice === 'custom') {
        newPersonality = await input({
          message: 'Describe your companion\'s personality',
        });
      }
    }

    if (newPersonality && newPersonality !== currentPersonality) {
      try {
        setCompanionPersonality(newPersonality);
        console.log(chalk.green('  Personality updated.'));
      } catch (err) {
        console.log(chalk.yellow(`  Could not update personality: ${err.message}`));
      }
    }
  } else if (flags.personality) {
    console.log(chalk.dim('  No companion hatched yet — personality will be set when you run /buddy'));
  }

  if (running) {
    console.log(chalk.bold.yellow('\n  Done! Quit all Claude Code sessions and relaunch to see your new pet.'));
    console.log(chalk.dim('  Then run /buddy to meet your new companion.\n'));
  } else {
    console.log(chalk.bold.green('\n  Done! Launch Claude Code and run /buddy to see your new pet.\n'));
  }
}

// ─── Flag validation ───

function validateFlag(name, value, allowed) {
  if (value === undefined) return undefined;
  if (value === 'any') return undefined; // treat 'any' as unset
  if (allowed.includes(value)) return value;
  throw new Error(
    `Invalid --${name} "${value}". Must be one of: ${allowed.join(', ')}`
  );
}

// ─── Selection helpers ───

async function selectSpecies() {
  return select({
    message: 'Species',
    choices: SPECIES.map(s => {
      const face = renderFace({ species: s, eye: '·' });
      return { name: `${s.padEnd(10)} ${face}`, value: s };
    }),
    pageSize: 18,
  });
}

async function selectEyes(species) {
  return select({
    message: 'Eyes',
    choices: EYES.map(e => {
      const face = renderFace({ species, eye: e });
      return { name: `${e}  ${face}`, value: e };
    }),
  });
}

async function selectRarity() {
  return select({
    message: 'Rarity',
    choices: RARITIES.map(r => {
      const color = RARITY_CHALK[r] || chalk.white;
      const pct = RARITY_WEIGHTS[r];
      return {
        name: color(`${r.padEnd(12)} ${RARITY_STARS[r].padEnd(6)} (normally ${pct}%)`),
        value: r,
      };
    }),
  });
}

async function selectHat(species, eye, rarity) {
  if (rarity === 'common') {
    console.log(chalk.dim('  Common rarity = no hat (this is how Claude Code works)\n'));
    return 'none';
  }

  return select({
    message: 'Hat',
    choices: HATS.filter(h => h !== 'none').map(h => {
      const preview = renderSprite({ species, eye, hat: h, rarity }, 0);
      const topLine = preview[0]?.trim() || h;
      return { name: `${h.padEnd(12)} ${topLine}`, value: h };
    }),
  });
}

async function selectStat(label, exclude) {
  const choices = STAT_NAMES
    .filter(s => s !== exclude)
    .map(s => ({ name: s, value: s }));

  return select({ message: label, choices });
}
