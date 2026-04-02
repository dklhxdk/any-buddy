#!/usr/bin/env node
// This script brute-forces salts to find a matching companion.
// Called by finder.mjs as a subprocess.
// Runs under Bun (wyhash) by default, or Node (FNV-1a) when --fnv1a is passed.
//
// On Windows npm installs, Claude Code's cli.js runs under Node, not Bun.
// The companion hash function has a runtime branch:
//   if (typeof Bun !== "undefined") → Bun.hash (wyhash)
//   else → FNV-1a
// So we must use FNV-1a when searching for salts targeting Node-based installs.
//
// Args: <userId> <species> <rarity> <eye> <hat> <shiny> <peak> <dump> [--fnv1a]
// Outputs JSON: { salt, attempts, elapsed }

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };
const SPECIES = [
  'duck', 'goose', 'blob', 'cat', 'dragon', 'octopus', 'owl', 'penguin',
  'turtle', 'snail', 'ghost', 'axolotl', 'capybara', 'cactus', 'robot',
  'rabbit', 'mushroom', 'chonk',
];
const EYES = ['·', '✦', '×', '◉', '@', '°'];
const HATS = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck'];
const STAT_NAMES = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'];

// Detect --fnv1a flag
const useFnv1a = process.argv.includes('--fnv1a');

function fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashKey(key) {
  if (useFnv1a) return fnv1a(key);
  return Number(BigInt(Bun.hash(key)) & 0xffffffffn);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function rollRarity(rng) {
  const total = 100;
  let roll = rng() * total;
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll < 0) return rarity;
  }
  return 'common';
}

// quickRoll() removed — inlined into the hot loop with early-exit checks
// to avoid computing attributes that won't match.

const SALT_LEN = 15;
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const REPORT_INTERVAL = 100_000;

function randomSalt() {
  let s = '';
  for (let i = 0; i < SALT_LEN; i++) {
    s += CHARSET[(Math.random() * CHARSET.length) | 0];
  }
  return s;
}

// Filter out --fnv1a from args
const args = process.argv.slice(2).filter(a => a !== '--fnv1a');
const [userId, wantSpecies, wantRarity, wantEye, wantHat, wantShiny, wantPeak, wantDump] = args;

if (!userId || !wantSpecies || !wantRarity || !wantEye || !wantHat) {
  console.error('Usage: finder-worker.mjs <userId> <species> <rarity> <eye> <hat> [shiny] [peak] [dump] [--fnv1a]');
  process.exit(1);
}

const requireShiny = wantShiny === 'true';
const requirePeak = wantPeak && wantPeak !== 'any' ? wantPeak : null;
const requireDump = wantDump && wantDump !== 'any' ? wantDump : null;
const needStats = !!(requirePeak || requireDump);

const start = Date.now();
let attempts = 0;

try {
  // Verify hash function is available
  if (!useFnv1a && (typeof Bun === 'undefined' || typeof Bun.hash !== 'function')) {
    console.error(
      `Bun.hash is not available (typeof Bun: ${typeof Bun}).\n` +
      `This worker must run under Bun, or pass --fnv1a for Node-based Claude installs.`
    );
    process.exit(1);
  }

  if (useFnv1a) {
    process.stderr.write(JSON.stringify({ info: 'Using FNV-1a hash (Node runtime detected)' }) + '\n');
  }

  while (true) {
    attempts++;
    const salt = randomSalt();
    const key = userId + salt;
    const seed = hashKey(key);
    const rng = mulberry32(seed);

    // Early-exit: check each attribute immediately after rolling.
    // Skips remaining RNG calls as soon as a mismatch is found.
    do {
      const rarity = rollRarity(rng);
      if (rarity !== wantRarity) break;

      const species = pick(rng, SPECIES);
      if (species !== wantSpecies) break;

      const eye = pick(rng, EYES);
      if (eye !== wantEye) break;

      const hat = rarity === 'common' ? 'none' : pick(rng, HATS);
      if (hat !== wantHat) break;

      const shiny = rng() < 0.01;
      if (requireShiny && !shiny) break;

      if (needStats) {
        let peak = pick(rng, STAT_NAMES);
        let dump = pick(rng, STAT_NAMES);
        while (dump === peak) dump = pick(rng, STAT_NAMES);
        if (requirePeak && peak !== requirePeak) break;
        if (requireDump && dump !== requireDump) break;
      }

      // All attributes match
      console.log(JSON.stringify({
        salt,
        attempts,
        elapsed: Date.now() - start,
      }));
      process.exit(0);
    } while (false);

    if (attempts % REPORT_INTERVAL === 0) {
      process.stderr.write(JSON.stringify({ attempts, elapsed: Date.now() - start }) + '\n');
    }
  }
} catch (err) {
  console.error(`Worker crashed after ${attempts} attempts (${Date.now() - start}ms): ${err.message}`);
  console.error(err.stack);
  process.exit(1);
}
