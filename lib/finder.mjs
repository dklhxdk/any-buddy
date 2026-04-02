import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import { RARITY_WEIGHTS, diagnostics } from './constants.mjs';
import { findBunBinary, isNodeRuntime } from './patcher.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'finder-worker.mjs');

function getCoreCount() {
  // availableParallelism() is more accurate but only exists in Node 19.4+ / newer 18.x.
  // Access it as a property to stay compatible with node >=18.0 as declared in package.json.
  if (typeof os.availableParallelism === 'function') return os.availableParallelism();
  return os.cpus().length || 4;
}

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

// Spawns parallel worker subprocesses that brute-force salts.
// Uses Bun (wyhash) for compiled binary installs, or Node (FNV-1a) for npm .js installs.
// Uses all available CPU cores (capped at 8) for ~linear speedup.
// Calls onProgress with { attempts, elapsed, rate, expected, pct, eta, workers } on each tick.
// Returns a promise resolving to { salt, attempts, elapsed }.
export function findSalt(userId, desired, { onProgress, binaryPath } = {}) {
  const expected = estimateAttempts(desired);

  // Detect if the Claude binary is a .js file run by Node — if so, use FNV-1a
  const useNodeHash = binaryPath ? isNodeRuntime(binaryPath) : false;
  const runtime = useNodeHash ? process.execPath : findBunBinary();
  // Cap at 8: diminishing returns beyond this, leaves cores free for the user
  const numWorkers = Math.max(1, Math.min(getCoreCount(), 8));

  return new Promise((resolve, reject) => {
    const args = [
      WORKER_PATH,
      userId,
      desired.species,
      desired.rarity,
      desired.eye,
      desired.hat,
      String(desired.shiny ?? false),
      desired.peak ?? 'any',
      desired.dump ?? 'any',
    ];

    // When targeting Node runtime, pass --fnv1a so the worker uses FNV-1a hash
    if (useNodeHash) {
      args.push('--fnv1a');
    }

    // Scale timeout with expected attempts, adjusted for parallelism
    const effectiveExpected = Math.ceil(expected / numWorkers);
    const timeout = Math.max(600000, Math.ceil(effectiveExpected / 50_000_000) * 60_000 + 600_000);

    const children = [];
    const workerAttempts = new Array(numWorkers).fill(0);
    const workerStdout = new Array(numWorkers).fill('');
    const workerStderr = new Array(numWorkers).fill('');
    let resolved = false;
    let exited = 0;

    function killAll() {
      for (const child of children) {
        try { child.kill(); } catch { /* already dead */ }
      }
    }

    for (let i = 0; i < numWorkers; i++) {
      const child = spawn(runtime, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
      });

      child.stdout.on('data', (chunk) => {
        workerStdout[i] += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        workerStderr[i] += text;
        if (!onProgress || resolved) return;

        const lines = text.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const progress = JSON.parse(line);
            if (progress.info) return; // Skip info messages
            workerAttempts[i] = progress.attempts;
            const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);
            const elapsed = progress.elapsed;
            const rate = totalAttempts / (elapsed / 1000);
            const pct = Math.min(100, (totalAttempts / expected) * 100);
            const remaining = Math.max(0, expected - totalAttempts);
            const eta = rate > 0 ? remaining / rate : Infinity;
            onProgress({ attempts: totalAttempts, elapsed, rate, expected, pct, eta, workers: numWorkers });
          } catch {
            // Not JSON — error message, captured in stderr
          }
        }
      });

      child.on('close', (code, signal) => {
        exited++;
        if (resolved) return;

        if (code === 0 && workerStdout[i].trim()) {
          resolved = true;
          killAll();
          try {
            const result = JSON.parse(workerStdout[i].trim());
            // Use the winner's actual attempts (not the stale progress value)
            // and add the last-known counts from the other workers.
            workerAttempts[i] = result.attempts;
            const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);
            result.totalAttempts = Math.max(totalAttempts, result.attempts);
            result.workers = numWorkers;
            resolve(result);
          } catch (err) {
            reject(new Error(`Failed to parse finder result: ${workerStdout[i].trim()}`));
          }
          return;
        }

        // All workers exited without finding a match
        if (exited === numWorkers) {
          const reason = signal ? `killed by ${signal}` : `exited with code ${code}`;
          const allStderr = workerStderr.join('\n').split('\n').filter(l => {
            try { JSON.parse(l); return false; } catch { return true; }
          }).join('\n').trim();
          const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);
          const extra = {
            Runtime: `${runtime} (${useNodeHash ? 'FNV-1a' : 'wyhash'})`,
            Workers: numWorkers,
            'Total attempts': `~${totalAttempts.toLocaleString()}`,
            Expected: `~${expected.toLocaleString()} attempts`,
            Timeout: `${(timeout / 1000).toFixed(0)}s`,
            Args: `[${args.slice(1).map(a => `"${a}"`).join(', ')}]`,
          };
          if (allStderr) extra['Worker stderr'] = allStderr;
          reject(new Error(`Salt finder ${reason}\n\n${diagnostics(extra)}`));
        }
      });

      child.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        killAll();
        reject(new Error(
          `Failed to spawn salt finder: ${err.message}\n\n${diagnostics({ Runtime: runtime })}`
        ));
      });

      children.push(child);
    }
  });
}
