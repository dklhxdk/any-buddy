import { existsSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { platform } from 'os';
import chalk from 'chalk';
import { ORIGINAL_SALT } from './constants.mjs';
import { findClaudeBinary, findBunBinary, verifySalt } from './patcher.mjs';
import { getClaudeUserId, loadPetConfig } from './config.mjs';

const ISSUE_URL = 'https://github.com/cpaczek/any-buddy/issues';

// Run all preflight checks before doing anything destructive.
// Returns { ok, binaryPath, userId, saltCount } or throws with a helpful message.
export function runPreflight({ requireBinary = true } = {}) {
  const errors = [];
  const warnings = [];

  // ── 1. Check bun is installed ──
  let bunVersion = null;
  try {
    const bunPath = findBunBinary();
    bunVersion = execSync(`"${bunPath}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    errors.push(
      'Bun is not installed or not on PATH.\n' +
      '  any-buddy needs Bun to compute the correct hash (Claude Code uses Bun.hash/wyhash).\n' +
      '  Install Bun: https://bun.sh'
    );
  }

  // ── 2. Check Claude config exists and has a userId ──
  const userId = getClaudeUserId();
  if (userId === 'anon') {
    warnings.push(
      'No user ID found in ~/.claude.json (using "anon").\n' +
      '  This usually means Claude Code hasn\'t been set up yet.\n' +
      '  The generated pet may not match what Claude Code shows.'
    );
  }

  // ── 3. Find and validate the binary ──
  let binaryPath = null;
  let saltCount = 0;

  if (requireBinary) {
    try {
      binaryPath = findClaudeBinary();
    } catch (err) {
      errors.push(err.message);
    }

    if (binaryPath) {
      // Check binary size — should be substantial (>1MB), not a shell script or shim
      try {
        const size = statSync(binaryPath).size;
        if (size < 1_000_000) {
          warnings.push(
            `Binary at ${binaryPath} is only ${(size / 1024).toFixed(0)}KB.\n` +
            '  This might be a shell script, symlink wrapper, or npm shim rather than the actual binary.\n' +
            '  If patching fails, try setting CLAUDE_BINARY to the real compiled binary.'
          );
        }
      } catch { /* ignore */ }

      // Check that a known salt exists in the binary (original or previously patched)
      try {
        const origResult = verifySalt(binaryPath, ORIGINAL_SALT);
        saltCount = origResult.found;

        if (saltCount === 0) {
          // Not original — check if it's already patched by any-buddy
          const petConfig = loadPetConfig();
          if (petConfig?.salt) {
            const patchedResult = verifySalt(binaryPath, petConfig.salt);
            const minCount = platform() === 'win32' ? 1 : 3;
            if (patchedResult.found >= minCount) {
              // Already patched by us — that's fine, we can re-patch
              saltCount = patchedResult.found;
              warnings.push(
                `Binary is already patched with a custom salt from a previous run.\n` +
                '  Re-patching will replace it with your new selection.'
              );
            } else {
              errors.push(
                `Neither the original salt nor your saved salt were found in ${binaryPath}.\n` +
                '  The binary may have been updated or patched by another tool.\n' +
                '  Try: any-buddy restore\n' +
                `\n  Platform: ${platform()}, binary: ${binaryPath}` +
                `\n  Please report this at: ${ISSUE_URL}`
              );
            }
          } else {
            errors.push(
              `Salt "${ORIGINAL_SALT}" not found in ${binaryPath}.\n` +
              '  Possible reasons:\n' +
              '  - Binary was patched by another tool\n' +
              '  - This binary format doesn\'t contain the salt as a plain string\n' +
              '  - Claude Code changed the salt in a new version\n' +
              `\n  Platform: ${platform()}, binary: ${binaryPath}` +
              `\n  Please report this at: ${ISSUE_URL}`
            );
          }
        } else if (platform() !== 'win32' && saltCount < 3) {
          warnings.push(
            `Salt found only ${saltCount} time(s) in binary (expected 3).\n` +
            '  This might work but the patch may be incomplete.\n' +
            `  Platform: ${platform()}`
          );
        }
      } catch (err) {
        errors.push(
          `Could not read binary at ${binaryPath}: ${err.message}\n` +
          '  Check file permissions.'
        );
      }

      // Platform-specific warnings
      const plat = platform();
      if (plat === 'win32') {
        warnings.push(
          'Windows support is experimental.\n' +
          '  You must close all Claude Code windows before patching.\n' +
          '  If you encounter issues, please report them at: ' + ISSUE_URL
        );
      } else if (plat === 'darwin') {
        warnings.push(
          'macOS: the binary will be ad-hoc re-signed after patching.\n' +
          '  If Claude Code won\'t launch, run `any-buddy restore`.\n' +
          '  Please report issues at: ' + ISSUE_URL
        );
      }
    }
  }

  // ── Print results ──
  for (const w of warnings) {
    console.log(chalk.yellow(`  Warning: ${w}\n`));
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.log(chalk.red(`  Error: ${e}\n`));
    }
    return { ok: false, binaryPath, userId, saltCount, bunVersion };
  }

  return { ok: true, binaryPath, userId, saltCount, bunVersion };
}
