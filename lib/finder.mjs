import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'finder-worker.mjs');

// Spawns a Bun subprocess that brute-forces salts using native Bun.hash.
// Returns { salt, attempts, elapsed }.
export function findSalt(userId, desired) {
  const result = execFileSync('bun', [
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
    encoding: 'utf-8',
    timeout: 120000, // 2 minute timeout
    stdio: ['pipe', 'pipe', 'inherit'], // stderr passes through for progress
  });

  return JSON.parse(result.trim());
}
