# claude-code-any-buddy
Pick any Claude Code companion pet you want.

```bash
npx any-buddy
```

That's it. Follow the prompts to choose your species, rarity, eyes, hat, and name.

Claude Code assigns you a deterministic pet based on your account ID — you can't change it through normal means. This tool lets you choose your own species, rarity, eyes, and hat, then patches the Claude Code binary to make it happen.

<p align="center">
  <img src="assets/demo.svg" alt="Demo of claude-code-any-buddy" width="700">
</p>

## How it works

Claude Code's companion system generates your pet's visual traits (species, rarity, eyes, hat) by hashing your user ID with a salt string (`friend-2026-401`), then feeding that hash into a deterministic PRNG (Mulberry32). The result is always the same pet for the same user — and it's recalculated on every launch, so you can't override it through config files.

**claude-code-any-buddy** works by:

1. **You pick** your desired species, rarity, eyes, and hat through an interactive TUI
2. **Brute-force search** finds a replacement salt string that produces your chosen pet when combined with your real user ID (typically takes <100ms)
3. **Binary patch** replaces the salt in the compiled Claude Code ELF binary (all 3 occurrences) using an atomic rename, with a backup created first
4. **Auto-repair hook** (optional) installs a `SessionStart` hook in `~/.claude/settings.json` that re-applies the patch after Claude Code updates

The patch is safe — it uses `rename()` to atomically swap the binary, which is the same technique package managers use. A running Claude session continues using the old binary in memory; the new pet appears on next launch.

## Requirements

- **Node.js >= 18** — for the CLI and TUI
- **Bun** — required for hash computation (Claude Code uses `Bun.hash`/wyhash internally; FNV-1a produces different results). Bun is typically already installed if you have Claude Code
- **Claude Code** — installed via any standard method

### Platform support

| Platform | Status | Binary location (auto-detected) |
|---|---|---|
| Linux | Tested | `~/.local/share/claude/versions/<ver>` |
| macOS | Should work | `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `~/.claude/local/claude` |
| Windows | Should work | `%LOCALAPPDATA%\Programs\claude\claude.exe`, npm global shim |

The binary is found automatically via `which`/`where` and platform-specific known paths. If auto-detection fails, set `CLAUDE_BINARY=/path/to/binary` manually.

## Install

The interactive flow also lets you **rename** your companion — it edits `~/.claude.json` directly so the name change takes effect immediately.

## Install

```bash
# Clone and install
git clone https://github.com/cpaczek/any-buddy.git
cd claude-code-any-buddy
pnpm install

# Link globally (optional, enables the apply command for auto-patch hook)
pnpm link --global
```

Or via npm:

```bash
npm install -g claude-code-any-buddy
```

## Usage

```bash
# Interactive pet picker (default) — pick your pet and apply
claude-code-any-buddy

# Show your current pet
claude-code-any-buddy current

# Browse and preview pets without applying
claude-code-any-buddy preview

# Re-apply saved pet after a Claude Code update
claude-code-any-buddy apply

# Silent re-apply (used by the SessionStart hook)
claude-code-any-buddy apply --silent

# Restore original pet
claude-code-any-buddy restore

# Non-interactive with flags (skip prompts you already know the answer to)
claude-code-any-buddy --species dragon --rarity legendary --eye '✦' --hat wizard --name Draco --yes
```

### CLI flags

| Flag | Short | Description |
|---|---|---|
| `--species <name>` | `-s` | Pre-select species |
| `--rarity <level>` | `-r` | Pre-select rarity |
| `--eye <char>` | `-e` | Pre-select eye style |
| `--hat <name>` | `-t` | Pre-select hat |
| `--name <name>` | `-n` | Rename your companion |
| `--personality <desc>` | `-p` | Set companion personality (controls speech bubble tone) |
| `--yes` | `-y` | Skip all confirmation prompts |
| `--shiny` | | Require shiny variant (~100x longer search) |
| `--peak <stat>` | | Best stat: DEBUGGING, PATIENCE, CHAOS, WISDOM, or SNARK |
| `--dump <stat>` | | Worst stat (~20x longer search with both) |
| `--no-hook` | | Don't offer to install the auto-patch hook |
| `--silent` | | Suppress output (for `apply` in hooks) |

Any flag you don't provide will be prompted interactively.

### Current pet

<p align="center">
  <img src="assets/current.svg" alt="Current pet display" width="500">
</p>

## All species

There are **18 companion species**. Each has 3 animation frames for idle fidget, and eyes/hats are applied as overlays.

<p align="center">
  <img src="assets/species.svg" alt="All 18 species" width="700">
</p>

```
duck        goose       blob        cat         dragon      octopus
    __           (·>       .----.      /\_/\      /^\  /^\     .----.
  <(· )___       ||      ( ·  · )   ( ·   ·)   <  ·  ·  >   ( ·  · )
   (  ._>      _(__)_    (      )   (  ω  )    (   ~~   )   (______)
    `--´        ^^^^      `----´    (")_(")     `-vvvv-´    /\/\/\/\

owl         penguin     turtle      snail       ghost       axolotl
   /\  /\    .---.       _,--._    ·    .--.     .----.   }~(______)~{
  ((·)(·))   (·>·)      ( ·  · )    \  ( @ )   / ·  · \  }~(· .. ·)~{
  (  ><  )  /(   )\    /[______]\    \_`--´    |      |    ( .--. )
   `----´    `---´      ``    ``    ~~~~~~~    ~`~``~`~    (_/  \_)

capybara    cactus      robot       rabbit      mushroom    chonk
  n______n   n  ____  n    .[||].     (\__/)    .-o-OO-o-.   /\    /\
 ( ·    · )  | |·  ·| |  [ ·  · ]   ( ·  · )  (__________)  ( ·    · )
 (   oo   )  |_|    |_|  [ ==== ]  =(  ..  )=    |·  ·|     (   ..   )
  `------´     |    |     `------´   (")__(")     |____|      `------´
```

## Customization options

<p align="center">
  <img src="assets/options.svg" alt="Customization options" width="700">
</p>

### Rarities

| Rarity | Stars | Normal odds | Stat floor |
|---|---|---|---|
| Common | ★ | 60% | 5 |
| Uncommon | ★★ | 25% | 15 |
| Rare | ★★★ | 10% | 25 |
| Epic | ★★★★ | 4% | 35 |
| Legendary | ★★★★★ | 1% | 50 |

Common rarity pets get no hat. All other rarities roll a random hat.

### Eyes

Six eye styles available on every species:

| Style | Character |
|---|---|
| Dot | `·` |
| Sparkle | `✦` |
| Cross | `×` |
| Circle | `◉` |
| At | `@` |
| Degree | `°` |

### Hats

Seven hat styles (only for uncommon+ rarity):

```
crown       tophat      propeller   halo        wizard      beanie      tinyduck
 \^^^/       [___]        -+-       (   )        /^\        (___)         ,>
```

### Stats

Each pet has 5 stats: **DEBUGGING**, **PATIENCE**, **CHAOS**, **WISDOM**, **SNARK**. One peak stat, one dump stat, rest scattered. Higher rarity = higher stat floor. Stats are deterministic from the seed — you can't pick them individually, but different salts produce different stat rolls.

### Shiny

1% chance per seed. The interactive flow asks if you want shiny, or pass `--shiny` on the command line. Requiring shiny takes ~100x longer to find a matching salt (seconds instead of milliseconds) since only 1 in 100 seeds produce a shiny pet.

## How the auto-patch hook works

When you choose to install the hook, it adds this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "claude-code-any-buddy apply --silent"
      }
    ]
  }
}
```

On every Claude Code session start, this runs `apply --silent` which:
1. Reads your saved salt from `~/.claude-code-any-buddy.json`
2. Checks if the current binary already has the correct salt (fast `Buffer.indexOf`)
3. If not (Claude updated), re-patches — same string replacement, same logic
4. Silent mode: produces no output unless a patch was actually applied

The hook adds negligible startup time (~50ms) when no patch is needed.

## How the binary patch works

Claude Code is a compiled Bun ELF binary at `~/.local/share/claude/versions/<version>`. The salt string `"friend-2026-401"` appears exactly 3 times:
- 2 occurrences in the bundled JavaScript code sections
- 1 occurrence in a string table / data section

The patch:
1. Reads the binary into a buffer
2. Finds all 3 occurrences of the old salt
3. Replaces each with the new salt (always exactly 15 characters — same length, no byte offset shifts)
4. Writes to a temp file, then atomically renames it over the original
5. Verifies by re-reading

The atomic rename (`rename()` syscall) is safe even while Claude Code is running — the OS keeps the old inode open for any running process. The new binary takes effect on next launch.

A backup is always created at `<binary-path>.anybuddy-bak` before the first patch.

## Files

| File | Purpose |
|---|---|
| `~/.claude.json` | Read-only — your user ID is read from here |
| `~/.claude-code-any-buddy.json` | Stores your chosen salt and pet config |
| `~/.claude/settings.json` | SessionStart hook is added here (optional) |
| `<binary>.anybuddy-bak` | Backup of the original binary |

## Restoring

```bash
# Restore original pet and remove the hook
claude-code-any-buddy restore
```

This patches the salt back to the original, removes the SessionStart hook, and clears the saved config.

## Limitations

- **Tested on Linux** — macOS and Windows should work but are not yet tested. Please [open an issue](https://github.com/cpaczek/any-buddy/issues) if you hit problems
- **Requires Bun** — needed for matching Claude Code's wyhash implementation
- **Salt string dependent** — if Anthropic changes the salt from `friend-2026-401` in a future version, the patch logic would need updating (but the tool will detect this and warn you)
- **Stats partially selectable** — you can pick which stat is highest (peak) and lowest (dump), but not exact values
- **Personality** — generated by Claude on first `/buddy` run after patching, not controlled by this tool. Delete the `companion` key from `~/.claude.json` to re-hatch with a new personality
- **Speech bubble** — your buddy's speech bubble reactions are generated by Claude based on the personality and name stored in `~/.claude.json`. After patching the visual, the buddy will still *talk* like the original personality unless you update it. Use the interactive prompt or `--personality "your description here"` to change what your buddy says
- **Name** — can be changed at any time via the interactive flow or `--name` flag (edits `~/.claude.json` directly)

## License

MIT
