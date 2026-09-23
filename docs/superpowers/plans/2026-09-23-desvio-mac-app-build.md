# Desvio Mac App Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Apple Silicon `Paseo Plus.app` from upstream Paseo `v0.9.1` plus the `fork/browser-default-url-paseo-json` topic branch, without installing or launching it.

**Architecture:** Desvio creates a disposable integration worktree, merges the topic branch onto the pinned upstream tag, and runs Paseo's typecheck and lint gates. Desvio's Paseo package task then creates an ad-hoc-signed Apple Silicon app with a distinct bundle name and no updater configuration. Installation is a separate plan because the supplied Desvio installer enables a local daemon, while this deployment requires a remote-only Mac client.

**Tech Stack:** macOS on Apple Silicon, Git, Bash, Node.js 22.20.0, npm workspaces, Desvio, Expo web export, Electron Builder, macOS `codesign` and `plutil`, optional ImageMagick and Claude Code

**Spec:** `docs/superpowers/specs/2026-09-23-desvio-daily-fork-deployment-design.md`

## Global Constraints

- Build on an Apple Silicon Mac.
- Pin the upstream base to `v0.9.1` (`81865852011df86aa0ad0ae411cb2f5e4078153f`).
- Merge `fork/browser-default-url-paseo-json`; record its resolved commit before building.
- Use the shared pair release ID `0.9.1-plus.20260923-1` for this Mac build and the later Debian build.
- Install the result as `Paseo Plus.app`, not `Paseo.app`.
- The package must not contain `app-update.yml`.
- Do not run the supplied `desvio run install` yet. Its current script enables the bundled local daemon.
- Do not launch the packaged app until the remote-only installation settings are prepared.
- Keep the Paseo checkout and Desvio config directory separate.

## Review Focus

- A moved topic branch must be visible in the recorded commit and must not silently change the build inputs.
- A topic branch forked after the selected stable tag must fail the ancestry check instead of carrying unrelated upstream commits.
- A non-Apple-Silicon host must stop before packaging.
- Any generated `app-update.yml` must fail verification because it would let the official updater replace the fork.
- A package with the wrong version, bundle ID, architecture, or invalid deep signature must not proceed to installation.

---

### Task 1: Verify the Mac build toolchain

**Files:**

- Read: `~/src/paseo/.tool-versions`
- Create: none

**Interfaces:**

- Consumes: an Apple Silicon Mac with a terminal
- Produces: Git, Node.js 22.20.0, npm, Xcode command-line tools, and optional packaging helpers on `PATH`

- [ ] **Step 1: Check the host architecture and core tools**

```bash
uname -m
xcode-select -p
git --version
node --version
npm --version
command -v codesign
command -v plutil
command -v lipo
```

Expected:

- `uname -m` prints `arm64`.
- `xcode-select -p` prints an installed developer directory.
- `node --version` prints `v22.20.0`.
- Every command exits with status 0.

If `xcode-select -p` fails, install Apple's command-line tools:

```bash
xcode-select --install
```

If Node 22.20.0 is not active, install and select it with the Node version manager already used on the Mac. For `nvm`:

```bash
nvm install 22.20.0
nvm use 22.20.0
```

- [ ] **Step 2: Install or check optional helpers**

ImageMagick adds the plus badge. Claude Code is used only if Desvio meets a new merge conflict.

```bash
command -v magick || brew install imagemagick
command -v claude || printf '%s\n' 'Claude Code is absent. A clean merge can build, but Desvio cannot resolve a new conflict automatically.'
```

Expected: `magick` is available. `claude` is optional for a clean merge. If a conflict occurs without it, abort the build and install Claude Code or repair the topic branch before retrying.

- [ ] **Step 3: Record the tool versions**

```bash
{
  date -u '+built-at=%Y-%m-%dT%H:%M:%SZ'
  uname -m | sed 's/^/arch=/'
  sw_vers -productVersion | sed 's/^/macos=/'
  node --version | sed 's/^/node=/'
  npm --version | sed 's/^/npm=/'
  git --version | sed 's/^/git=/'
} | tee "$HOME/paseo-plus-mac-toolchain.txt"
```

Expected: `~/paseo-plus-mac-toolchain.txt` contains the build environment.

### Task 2: Prepare the Paseo checkout and fixed source inputs

**Files:**

- Create: `~/src/paseo/` when no checkout exists
- Modify: `~/src/paseo/.git/config` only when the `fork` remote is missing
- Create: `~/paseo-plus-mac-inputs.txt`

**Interfaces:**

- Consumes: upstream repository `getpaseo/paseo`, fork repository `mourique/paseo`
- Produces: local refs `v0.9.1` and `fork/browser-default-url-paseo-json`, plus recorded immutable commit IDs

- [ ] **Step 1: Clone or update the upstream checkout**

For a new checkout:

```bash
mkdir -p "$HOME/src"
git clone git@github.com:getpaseo/paseo.git "$HOME/src/paseo"
cd "$HOME/src/paseo"
git remote add fork git@github.com:mourique/paseo.git
```

For an existing checkout, enter it and add `fork` only if missing:

```bash
cd "$HOME/src/paseo"
git remote get-url fork >/dev/null 2>&1 || \
  git remote add fork git@github.com:mourique/paseo.git
```

- [ ] **Step 2: Fetch the stable tag and topic branch**

```bash
cd "$HOME/src/paseo"
git fetch origin --tags --prune
git fetch fork \
  '+refs/heads/browser-default-url-paseo-json:refs/remotes/fork/browser-default-url-paseo-json'
```

Expected: both fetches succeed.

Desvio gives a local branch precedence over a remote-tracking ref with the same slash-qualified name. Refuse that ambiguous state:

```bash
cd "$HOME/src/paseo"
if git show-ref --verify --quiet refs/heads/fork/browser-default-url-paseo-json; then
  printf '%s\n' 'STOP: local branch fork/browser-default-url-paseo-json shadows the fork remote.' >&2
  exit 1
fi
```

Expected: exit status 0 and no output.

- [ ] **Step 3: Resolve and record the exact inputs**

```bash
cd "$HOME/src/paseo"
BASE_COMMIT=$(git rev-parse 'v0.9.1^{}')
TOPIC_COMMIT=$(git rev-parse 'fork/browser-default-url-paseo-json^{}')
FORK_POINT=$(git merge-base origin/main fork/browser-default-url-paseo-json)
printf 'base-tag=v0.9.1\nbase-commit=%s\ntopic-ref=%s\ntopic-commit=%s\nfork-point=%s\n' \
  "$BASE_COMMIT" \
  'fork/browser-default-url-paseo-json' \
  "$TOPIC_COMMIT" \
  "$FORK_POINT" | tee "$HOME/paseo-plus-mac-inputs.txt"
```

Expected base commit:

```text
81865852011df86aa0ad0ae411cb2f5e4078153f
```

At the time this plan was written, the topic commit was:

```text
3803195248c187cc40ad928685777bef5ccd2d11
```

A later topic commit is acceptable only when it is intentional and recorded.

- [ ] **Step 4: Verify that the topic fork point is not newer than the stable base**

```bash
cd "$HOME/src/paseo"
FORK_POINT=$(git merge-base origin/main fork/browser-default-url-paseo-json)
git merge-base --is-ancestor "$FORK_POINT" 'v0.9.1^{}'
```

Expected: exit status 0 and no output. A nonzero status means this branch would carry upstream commits newer than the pinned base; stop and create a topic branch based on an ancestor of `v0.9.1`.

- [ ] **Step 5: Verify the topic contains the default-URL work**

```bash
cd "$HOME/src/paseo"
git log --oneline 'v0.9.1..fork/browser-default-url-paseo-json' -- \
  packages/protocol/src/paseo-config-schema.ts \
  packages/server/src/server/session.ts \
  packages/app/src/screens/workspace/workspace-screen.tsx
```

Expected: commits for the browser default URL appear. If no relevant commits appear, stop before building.

### Task 3: Install Desvio and create the Mac build configuration

**Files:**

- Create: `~/src/desvio/`
- Create: `~/.local/bin/desvio` symlink
- Create: `~/.paseo-plus-build/` from `examples/paseo`
- Modify: `~/.paseo-plus-build/desvio.conf`
- Modify: `~/.paseo-plus-build/manifest.txt`
- Modify: `~/.paseo-plus-build/paseo.conf`

**Interfaces:**

- Consumes: the prepared Paseo checkout and Desvio's Paseo example
- Produces: one pinned Desvio configuration for the Mac candidate

- [ ] **Step 1: Clone Desvio and expose its command**

```bash
mkdir -p "$HOME/src" "$HOME/.local/bin"
test -d "$HOME/src/desvio/.git" || \
  git clone https://github.com/cleiter/desvio.git "$HOME/src/desvio"
git -C "$HOME/src/desvio" pull --ff-only
ln -sfn "$HOME/src/desvio/bin/desvio" "$HOME/.local/bin/desvio"
export PATH="$HOME/.local/bin:$PATH"
desvio --help >/dev/null
```

Expected: `desvio --help` exits with status 0.

- [ ] **Step 2: Copy the Paseo example into a separate config directory**

```bash
test ! -e "$HOME/.paseo-plus-build" || {
  printf '%s\n' 'STOP: ~/.paseo-plus-build already exists; inspect it instead of overwriting it.' >&2
  exit 1
}
mkdir -p "$HOME/.paseo-plus-build"
cp -R "$HOME/src/desvio/examples/paseo/." "$HOME/.paseo-plus-build/"
```

Expected: `~/.paseo-plus-build/desvio.conf`, `manifest.txt`, `paseo.conf`, and `package.sh` exist.

- [ ] **Step 3: Pin the Paseo checkout and base tag in `desvio.conf`**

```bash
python3 - <<'PY'
from pathlib import Path

path = Path.home() / ".paseo-plus-build" / "desvio.conf"
text = path.read_text()
replacements = {
    'DESVIO_REPO="$HOME/workspace/paseo"': 'DESVIO_REPO="$HOME/src/paseo"',
    'DESVIO_BRANCH="plus"': 'DESVIO_BRANCH="paseo-plus-v0-9-1"',
    'DESVIO_NAME="paseo-plus"': 'DESVIO_NAME="paseo-plus-v0-9-1"',
    'DESVIO_BASE="origin/main"': 'DESVIO_BASE="v0.9.1"',
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"expected config line missing: {old}")
    text = text.replace(old, new, 1)
path.write_text(text)
PY

grep -E '^DESVIO_(REPO|BRANCH|NAME|BASE)=' "$HOME/.paseo-plus-build/desvio.conf"
```

Expected:

```text
DESVIO_REPO="$HOME/src/paseo"
DESVIO_BRANCH="paseo-plus-v0-9-1"
DESVIO_NAME="paseo-plus-v0-9-1"
DESVIO_BASE="v0.9.1"
```

- [ ] **Step 4: Replace the example manifest with the one topic branch**

```bash
cat > "$HOME/.paseo-plus-build/manifest.txt" <<'EOF'
fork/browser-default-url-paseo-json # personal browser default URL
EOF
cat "$HOME/.paseo-plus-build/manifest.txt"
```

Expected: one active manifest line.

- [ ] **Step 5: Add the fixed product identity and release ID to `paseo.conf`**

```bash
cat >> "$HOME/.paseo-plus-build/paseo.conf" <<'EOF'

# Daily fork build identity. Keep this release ID equal to the Debian daemon ID.
PASEO_PRODUCT_NAME="Paseo Plus"
PASEO_APP_ID="sh.paseo.desktop.plus"
PASEO_PACKAGE_VERSION="0.9.1-plus.20260923-1"
PASEO_LOGO_PLUS="auto"
EOF

tail -n 8 "$HOME/.paseo-plus-build/paseo.conf"
```

Expected: the four assignments appear exactly once at the end. Earlier default expressions in the example are harmless because these later assignments win.

### Task 4: Assemble and verify the fork source

**Files:**

- Create: `~/.paseo-plus-build/build-tree/`
- Create: `~/.paseo-plus-build/state/`
- Modify: the disposable Desvio integration ref in `~/src/paseo/.git`
- Do not modify: `browser-default-url-paseo-json`

**Interfaces:**

- Consumes: `v0.9.1`, the topic branch, and the Desvio configuration
- Produces: a gated integration tree ready for packaging

- [ ] **Step 1: Run the Desvio build**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/.paseo-plus-build"
desvio build
```

Expected:

- Desvio fetches the configured remotes.
- It recreates `paseo-plus-v0-9-1` from `v0.9.1`.
- It merges `fork/browser-default-url-paseo-json`.
- `npm ci` runs on the first build.
- `npm run build:server`, `npm run typecheck`, and `npm run lint` pass.
- The summary says the gate passed.

If a conflict appears and Claude Code is unavailable, stop safely:

```bash
cd "$HOME/.paseo-plus-build"
desvio abort
```

Expected: Desvio removes the incomplete merge. Install Claude Code or repair the topic branch in its own branch, push the new topic commit, record that commit, and restart Task 4. Do not improvise a release from a conflicted integration tree.

- [ ] **Step 2: Verify Desvio did not move the topic branch**

```bash
cd "$HOME/src/paseo"
RECORDED_TOPIC=$(sed -n 's/^topic-commit=//p' "$HOME/paseo-plus-mac-inputs.txt")
CURRENT_TOPIC=$(git rev-parse 'fork/browser-default-url-paseo-json^{}')
test "$CURRENT_TOPIC" = "$RECORDED_TOPIC"
printf 'topic commit unchanged: %s\n' "$CURRENT_TOPIC"
```

Expected: the test passes and prints the recorded topic commit.

- [ ] **Step 3: Record the assembled commit and tree hash**

```bash
BUILD_TREE="$HOME/.paseo-plus-build/build-tree"
{
  git -C "$BUILD_TREE" rev-parse HEAD | sed 's/^/integration-commit=/'
  git -C "$BUILD_TREE" rev-parse 'HEAD^{tree}' | sed 's/^/integration-tree=/'
} | tee -a "$HOME/paseo-plus-mac-inputs.txt"
```

Expected: both identities are appended to the input record.

### Task 5: Package `Paseo Plus.app`

**Files:**

- Create: `~/.paseo-plus-build/build-tree/packages/desktop/release/mac-arm64/Paseo Plus.app`
- Temporarily modify and restore inside the disposable tree: app/server package versions, native-version pattern, and icon assets

**Interfaces:**

- Consumes: the gated integration tree and `PASEO_PACKAGE_VERSION=0.9.1-plus.20260923-1`
- Produces: one local ad-hoc-signed Mac app with the official updater disabled

- [ ] **Step 1: Package the app**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/.paseo-plus-build"
desvio run package
```

Expected:

- app dependencies build;
- Expo exports the Electron renderer;
- Electron Builder creates an unsigned directory target;
- the script renames it to `Paseo Plus.app`;
- the script adds the daemon helper required by the renamed bundle;
- no updater configuration is present;
- the script deep-signs the complete bundle ad hoc;
- the final message reports version `0.9.1-plus.20260923-1`.

Do not run `desvio run install` in this task.

- [ ] **Step 2: Set the bundle path once for verification**

```bash
APP="$HOME/.paseo-plus-build/build-tree/packages/desktop/release/mac-arm64/Paseo Plus.app"
test -x "$APP/Contents/MacOS/Paseo"
printf '%s\n' "$APP"
```

Expected: the test passes and prints the bundle path.

### Task 6: Verify the packaged app and stop before installation

**Files:**

- Read: `Paseo Plus.app/Contents/Info.plist`
- Create: `~/paseo-plus-mac-artifact.txt`
- Do not modify: `/Applications`

**Interfaces:**

- Consumes: packaged `Paseo Plus.app`
- Produces: verified artifact metadata and a clear handoff to the remote-only installation plan

- [ ] **Step 1: Verify version, name, bundle ID, and architecture**

```bash
APP="$HOME/.paseo-plus-build/build-tree/packages/desktop/release/mac-arm64/Paseo Plus.app"
plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist"
plutil -extract CFBundleDisplayName raw "$APP/Contents/Info.plist"
plutil -extract CFBundleIdentifier raw "$APP/Contents/Info.plist"
lipo -archs "$APP/Contents/MacOS/Paseo"
```

Expected:

```text
0.9.1-plus.20260923-1
Paseo Plus
sh.paseo.desktop.plus
arm64
```

- [ ] **Step 2: Verify the deep signature**

```bash
APP="$HOME/.paseo-plus-build/build-tree/packages/desktop/release/mac-arm64/Paseo Plus.app"
codesign --verify --deep --strict --verbose=2 "$APP"
```

Expected: exit status 0. Diagnostic output may say the bundle is valid on disk.

- [ ] **Step 3: Prove that the official updater is disabled**

```bash
APP="$HOME/.paseo-plus-build/build-tree/packages/desktop/release/mac-arm64/Paseo Plus.app"
UPDATER_CONFIG=$(find "$APP" -name app-update.yml -print -quit)
test -z "$UPDATER_CONFIG"
printf '%s\n' 'updater config absent'
```

Expected: `updater config absent`.

- [ ] **Step 4: Record the artifact**

```bash
APP="$HOME/.paseo-plus-build/build-tree/packages/desktop/release/mac-arm64/Paseo Plus.app"
{
  printf 'path=%s\n' "$APP"
  plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist" | sed 's/^/version=/'
  plutil -extract CFBundleIdentifier raw "$APP/Contents/Info.plist" | sed 's/^/bundle-id=/'
  git -C "$HOME/.paseo-plus-build/build-tree" rev-parse HEAD | sed 's/^/integration-commit=/'
  git -C "$HOME/.paseo-plus-build/build-tree" rev-parse 'HEAD^{tree}' | sed 's/^/integration-tree=/'
} | tee "$HOME/paseo-plus-mac-artifact.txt"
```

Expected: the artifact record contains the bundle path, shared release ID, bundle ID, integration commit, and tree hash.

- [ ] **Step 5: Stop before installation**

Do not run either command yet:

```bash
# Do not run yet:
# desvio run install
# open "$HOME/.paseo-plus-build/build-tree/packages/desktop/release/mac-arm64/Paseo Plus.app"
```

The supplied installer sets `manageBuiltInDaemon=true`. The next plan must adapt installation so both Paseo apps share the saved host registry while `manageBuiltInDaemon=false` and no local Mac daemon starts.
