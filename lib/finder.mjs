import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { RARITY_WEIGHTS } from './constants.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'finder-worker.mjs');

// Calculate expected attempts based on probability of matching all desired traits.
export function estimateAttempts(desired) {
  // Species: 1/18
  let p = 1 / 18;

  // Rarity: weight / 100
  p *= RARITY_WEIGHTS[desired.rarity] / 100;

  // Eye: 1/6
  p *= 1 / 6;

  // Hat: common is always 'none' (guaranteed), otherwise 1/8
  if (desired.rarity !== 'common') {
    p *= 1 / 8;
  }

  // Shiny: 1/100
  if (desired.shiny) {
    p *= 0.01;
  }

  // Peak stat: 1/5
  if (desired.peak) {
    p *= 1 / 5;
  }

  // Dump stat: ~1/4 (picked from remaining 4, but rerolls on collision)
  if (desired.dump) {
    p *= 1 / 4;
  }

  // Expected attempts = 1/p (geometric distribution)
  return Math.round(1 / p);
}

// Spawns a Bun subprocess that brute-forces salts using native Bun.hash.
// Calls onProgress with { attempts, elapsed, rate, expected, pct, eta } on each tick.
// Returns a promise resolving to { salt, attempts, elapsed }.
export function findSalt(userId, desired, { onProgress } = {}) {
  const expected = estimateAttempts(desired);

  return new Promise((resolve, reject) => {
    const child = spawn('bun', [
      WORKER_PATH,
      userId,
      desired.species,
      desired.rarity,
      desired.eye,
      desired.hat,
      String(desired.shiny ?? false),
      desired.peak ?? 'any',
      desired.dump ?? 'any',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300000,
    });

    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      if (!onProgress) return;
      // Worker writes JSON progress lines to stderr
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const progress = JSON.parse(line);
          const rate = progress.attempts / (progress.elapsed / 1000); // attempts/sec
          const pct = Math.min(100, (progress.attempts / expected) * 100);
          // ETA based on expected remaining attempts at current rate
          const remaining = Math.max(0, expected - progress.attempts);
          const eta = rate > 0 ? remaining / rate : Infinity;
          onProgress({ ...progress, rate, expected, pct, eta });
        } catch {
          // Not JSON — ignore
        }
      }
    });

    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (err) {
          reject(new Error(`Failed to parse finder result: ${stdout.trim()}`));
        }
      } else {
        reject(new Error(`Salt finder exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}
