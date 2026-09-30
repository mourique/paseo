# Desvio Debian Daemon Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run the Debian Paseo daemon from the same pinned upstream and fork source used by the Mac `Paseo Plus.app`, while preserving `/home/golem/.paseo` and the global npm daemon as the rollback runtime.

**Architecture:** The existing `/home/golem/code/paseo` checkout supplies Git refs. Desvio assembles and verifies a separate disposable tree under `~/.paseo-plus-daemon`. The verified daemon runs from that tree with the existing Paseo home and persisted Tailscale listener; the unchanged global npm CLI remains available for rollback.

**Tech Stack:** Debian, Bash, Git, Node.js 22.20.0, npm workspaces, Desvio, Paseo standalone daemon, Tailscale

**Spec:** `docs/superpowers/specs/2026-09-23-desvio-daily-fork-deployment-design.md`

## Global Constraints

- Run the switch and rollback commands from a normal SSH terminal, not from a Paseo agent terminal. Stopping the daemon kills its agents, including an agent that runs the command.
- Keep `PASEO_HOME=/home/golem/.paseo`.
- Keep `daemon.listen=100.77.235.73:6767` from the persisted config. Do not set `PASEO_LISTEN`.
- Disable the relay explicitly in persisted config.
- Use the exact base commit, topic commit, integration tree, and release ID recorded by the completed Mac build.
- For the planned pair, the base is `v0.9.1` at `81865852011df86aa0ad0ae411cb2f5e4078153f`, and the release ID is `0.9.1-plus.20260923-1`.
- Do not replace, move, migrate, or delete `/home/golem/.paseo`.
- Do not uninstall or upgrade the global npm Paseo installation.
- Build and test before stopping the current daemon.
- Switch only when no agent turn is in progress.
- Do not run the full test suite.

## Review Focus

- A Mac and Debian topic-commit mismatch must stop before source assembly.
- A source-tree mismatch with the Mac build must stop before daemon startup.
- A live daemon serving the Desvio build tree must block a rebuild.
- A failed fork startup must leave a direct command for restarting the global daemon against the same home.
- The new daemon must report the shared release ID, original home, Tailscale listener, standalone ownership, and disabled relay before acceptance.

---

### Task 1: Copy the immutable Mac build record to Debian

**Files:**

- Read on Mac: `~/paseo-plus-mac-inputs.txt`
- Read on Mac: `~/paseo-plus-mac-artifact.txt`
- Create on Debian: `/home/golem/paseo-plus-mac-inputs.txt`
- Create on Debian: `/home/golem/paseo-plus-mac-artifact.txt`

**Interfaces:**

- Consumes: the completed Mac build records
- Produces: exact source and version values for the Debian build

- [ ] **Step 1: Inspect the records on the Mac**

Run on the Mac:

```bash
cat "$HOME/paseo-plus-mac-inputs.txt"
cat "$HOME/paseo-plus-mac-artifact.txt"
```

Expected:

- `base-tag=v0.9.1`
- `base-commit=81865852011df86aa0ad0ae411cb2f5e4078153f`
- one `topic-commit` value
- one `integration-tree` value
- `version=0.9.1-plus.20260923-1`

- [ ] **Step 2: Copy both records from the Mac to Debian**

Run on the Mac:

```bash
scp \
  "$HOME/paseo-plus-mac-inputs.txt" \
  "$HOME/paseo-plus-mac-artifact.txt" \
  golem@100.77.235.73:
```

Expected: both files transfer without an error.

- [ ] **Step 3: Load and validate the pair values on Debian**

Run on Debian:

```bash
BASE_TAG=$(sed -n 's/^base-tag=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
BASE_COMMIT=$(sed -n 's/^base-commit=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
TOPIC_COMMIT=$(sed -n 's/^topic-commit=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
MAC_TREE=$(sed -n 's/^integration-tree=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
RELEASE_ID=$(sed -n 's/^version=//p' "$HOME/paseo-plus-mac-artifact.txt" | tail -1)

printf 'base-tag=%s\nbase-commit=%s\ntopic-commit=%s\nmac-tree=%s\nrelease-id=%s\n' \
  "$BASE_TAG" "$BASE_COMMIT" "$TOPIC_COMMIT" "$MAC_TREE" "$RELEASE_ID"

test "$BASE_TAG" = "v0.9.1"
test "$BASE_COMMIT" = "81865852011df86aa0ad0ae411cb2f5e4078153f"
test -n "$TOPIC_COMMIT"
test -n "$MAC_TREE"
test "$RELEASE_ID" = "0.9.1-plus.20260923-1"
```

Expected: all five values print and every `test` exits with status 0. Do not continue if any value is missing or different.

### Task 2: Record the current Debian daemon and toolchain

**Files:**

- Create: `/home/golem/paseo-plus-global-cli-path.txt`
- Create: `/home/golem/paseo-plus-debian-before.json`
- Create: `/home/golem/paseo-plus-debian-toolchain.txt`
- Create: `/home/golem/.paseo/config.json.pre-desvio-0.9.1-plus.20260923-1`

**Interfaces:**

- Consumes: the current standalone global npm daemon
- Produces: a verified rollback executable, baseline status, config backup, and build toolchain

- [ ] **Step 1: Confirm the shell user and required tools**

```bash
whoami
command -v git
command -v node
command -v npm
command -v python3
command -v make
command -v g++
node --version
npm --version
df -h "$HOME"
```

Expected:

- `whoami` prints `golem`.
- Every `command -v` succeeds.
- Node prints `v22.20.0`.
- The home filesystem has enough free space for a second checkout worktree and `node_modules`.

If Node 22.20.0 is not active and this host uses `nvm`, run:

```bash
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 22.20.0
nvm use 22.20.0
```

If `python3`, `make`, or `g++` is missing, install the Debian build tools:

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

- [ ] **Step 2: Record the unchanged global CLI path**

```bash
GLOBAL_PASEO=$(readlink -f "$(command -v paseo)")
printf '%s\n' "$GLOBAL_PASEO" | tee "$HOME/paseo-plus-global-cli-path.txt"
test -x "$GLOBAL_PASEO"
"$GLOBAL_PASEO" --version
```

Expected: the path points into the existing global npm installation and `--version` prints its current stock version.

- [ ] **Step 3: Record the current daemon status**

```bash
GLOBAL_PASEO=$(cat "$HOME/paseo-plus-global-cli-path.txt")
"$GLOBAL_PASEO" daemon status --home /home/golem/.paseo --json | \
  tee "$HOME/paseo-plus-debian-before.json"
```

Expected status:

- `home` is `/home/golem/.paseo`.
- `listen` is `100.77.235.73:6767`.
- `desktopManaged` is `false`.
- `localDaemon` is `running`.

- [ ] **Step 4: Back up the persisted daemon configuration**

```bash
cp -a \
  /home/golem/.paseo/config.json \
  /home/golem/.paseo/config.json.pre-desvio-0.9.1-plus.20260923-1
cmp \
  /home/golem/.paseo/config.json \
  /home/golem/.paseo/config.json.pre-desvio-0.9.1-plus.20260923-1
```

Expected: `cmp` exits with status 0. This copies only configuration; Paseo state remains in place and is not migrated.

- [ ] **Step 5: Record the toolchain**

```bash
{
  date -u '+built-at=%Y-%m-%dT%H:%M:%SZ'
  uname -a | sed 's/^/kernel=/'
  node --version | sed 's/^/node=/'
  npm --version | sed 's/^/npm=/'
  git --version | sed 's/^/git=/'
} | tee "$HOME/paseo-plus-debian-toolchain.txt"
```

Expected: the file contains the Debian build environment.

### Task 3: Prepare the exact Paseo source inputs

**Files:**

- Read: `/home/golem/code/paseo/`
- Modify: `/home/golem/code/paseo/.git/config` only if the `fork` remote is missing
- Create or update Git ref: `refs/heads/paseo-plus-topic-v0-9-1`
- Create: `/home/golem/paseo-plus-debian-inputs.txt`

**Interfaces:**

- Consumes: the source values copied from the Mac
- Produces: one immutable local topic ref for Desvio

- [ ] **Step 1: Enter the existing Paseo checkout and verify its remotes**

```bash
PASEO_REPO="$HOME/code/paseo"
test -d "$PASEO_REPO/.git"
git -C "$PASEO_REPO" remote -v
git -C "$PASEO_REPO" remote get-url fork >/dev/null 2>&1 || \
  git -C "$PASEO_REPO" remote add fork git@github.com:mourique/paseo.git
```

Expected: `origin` points to upstream Paseo and `fork` points to `mourique/paseo`.

- [ ] **Step 2: Fetch the base tag and fork branch**

```bash
PASEO_REPO="$HOME/code/paseo"
git -C "$PASEO_REPO" fetch origin --tags --prune
git -C "$PASEO_REPO" fetch fork \
  '+refs/heads/browser-default-url-paseo-json:refs/remotes/fork/browser-default-url-paseo-json'
```

Expected: both fetches succeed. This does not change the checked-out branch.

- [ ] **Step 3: Resolve the exact Mac values again and prove the objects exist**

```bash
BASE_TAG=$(sed -n 's/^base-tag=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
BASE_COMMIT=$(sed -n 's/^base-commit=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
TOPIC_COMMIT=$(sed -n 's/^topic-commit=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)

PASEO_REPO="$HOME/code/paseo"
test "$(git -C "$PASEO_REPO" rev-parse "$BASE_TAG^{}")" = "$BASE_COMMIT"
git -C "$PASEO_REPO" cat-file -e "$TOPIC_COMMIT^{commit}"
```

Expected: both commands exit with status 0. If the topic object is missing, stop. Do not replace it with the current branch tip.

- [ ] **Step 4: Create a fixed local topic ref at the Mac commit**

```bash
PASEO_REPO="$HOME/code/paseo"
TOPIC_COMMIT=$(sed -n 's/^topic-commit=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
git -C "$PASEO_REPO" update-ref \
  refs/heads/paseo-plus-topic-v0-9-1 \
  "$TOPIC_COMMIT"
test "$(git -C "$PASEO_REPO" rev-parse paseo-plus-topic-v0-9-1)" = "$TOPIC_COMMIT"
```

Expected: the dedicated local ref resolves to the exact Mac topic commit, even if the fork branch later moves.

- [ ] **Step 5: Verify the topic fork point is not newer than the stable base**

```bash
PASEO_REPO="$HOME/code/paseo"
BASE_COMMIT=$(sed -n 's/^base-commit=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
TOPIC_COMMIT=$(sed -n 's/^topic-commit=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
FORK_POINT=$(git -C "$PASEO_REPO" merge-base origin/main "$TOPIC_COMMIT")
git -C "$PASEO_REPO" merge-base --is-ancestor "$FORK_POINT" "$BASE_COMMIT"
printf 'fork-point=%s\n' "$FORK_POINT"
```

Expected: the ancestry test exits with status 0. A nonzero result means the topic could carry upstream history newer than the selected stable base; stop.

- [ ] **Step 6: Record the Debian source inputs**

```bash
BASE_TAG=$(sed -n 's/^base-tag=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
BASE_COMMIT=$(sed -n 's/^base-commit=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
TOPIC_COMMIT=$(sed -n 's/^topic-commit=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
RELEASE_ID=$(sed -n 's/^version=//p' "$HOME/paseo-plus-mac-artifact.txt" | tail -1)

printf 'base-tag=%s\nbase-commit=%s\ntopic-ref=%s\ntopic-commit=%s\nrelease-id=%s\n' \
  "$BASE_TAG" \
  "$BASE_COMMIT" \
  'paseo-plus-topic-v0-9-1' \
  "$TOPIC_COMMIT" \
  "$RELEASE_ID" | tee "$HOME/paseo-plus-debian-inputs.txt"
```

Expected: the recorded base, topic, and release ID match the Mac records.

### Task 4: Install Desvio and create the Debian configuration

**Files:**

- Create: `/home/golem/src/desvio/`
- Create: `/home/golem/.local/bin/desvio`
- Create: `/home/golem/.paseo-plus-daemon/`
- Modify: `/home/golem/.paseo-plus-daemon/desvio.conf`
- Modify: `/home/golem/.paseo-plus-daemon/manifest.txt`
- Modify: `/home/golem/.paseo-plus-daemon/paseo.conf`
- Create: `/home/golem/.paseo-plus-daemon/stamp.sh`

**Interfaces:**

- Consumes: the fixed base and topic refs
- Produces: a Debian-only Desvio configuration and a reusable version-stamp task

- [ ] **Step 1: Clone or update Desvio**

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

- [ ] **Step 2: Copy Desvio's Paseo example into a Debian config directory**

```bash
test ! -e "$HOME/.paseo-plus-daemon" || {
  printf '%s\n' 'STOP: ~/.paseo-plus-daemon already exists; inspect it instead of overwriting it.' >&2
  exit 1
}
mkdir -p "$HOME/.paseo-plus-daemon"
cp -R "$HOME/src/desvio/examples/paseo/." "$HOME/.paseo-plus-daemon/"
```

Expected: the directory contains `desvio.conf`, `manifest.txt`, `paseo.conf`, `start.sh`, and `stop.sh`.

- [ ] **Step 3: Pin the checkout and base tag in `desvio.conf`**

```bash
python3 - <<'PY'
from pathlib import Path

path = Path.home() / ".paseo-plus-daemon" / "desvio.conf"
text = path.read_text()
replacements = {
    'DESVIO_REPO="$HOME/workspace/paseo"': 'DESVIO_REPO="$HOME/code/paseo"',
    'DESVIO_BRANCH="plus"': 'DESVIO_BRANCH="paseo-plus-daemon-v0-9-1"',
    'DESVIO_NAME="paseo-plus"': 'DESVIO_NAME="paseo-plus-daemon-v0-9-1"',
    'DESVIO_BASE="origin/main"': 'DESVIO_BASE="v0.9.1"',
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"expected config line missing: {old}")
    text = text.replace(old, new, 1)
path.write_text(text)
PY

grep -E '^DESVIO_(REPO|BRANCH|NAME|BASE)=' "$HOME/.paseo-plus-daemon/desvio.conf"
```

Expected:

```text
DESVIO_REPO="$HOME/code/paseo"
DESVIO_BRANCH="paseo-plus-daemon-v0-9-1"
DESVIO_NAME="paseo-plus-daemon-v0-9-1"
DESVIO_BASE="v0.9.1"
```

- [ ] **Step 4: Replace the example manifest with the fixed local topic ref**

```bash
cat > "$HOME/.paseo-plus-daemon/manifest.txt" <<'EOF'
paseo-plus-topic-v0-9-1 # exact topic commit recorded by the Mac build
EOF
cat "$HOME/.paseo-plus-daemon/manifest.txt"
```

Expected: one active manifest line.

- [ ] **Step 5: Add the real home and shared release ID to `paseo.conf`**

```bash
RELEASE_ID=$(sed -n 's/^version=//p' "$HOME/paseo-plus-mac-artifact.txt" | tail -1)
cat >> "$HOME/.paseo-plus-daemon/paseo.conf" <<EOF

# Debian daily daemon. Keep this release ID equal to the Mac app ID.
PASEO_REAL_HOME="/home/golem/.paseo"
PASEO_PACKAGE_VERSION="$RELEASE_ID"
EOF

tail -n 6 "$HOME/.paseo-plus-daemon/paseo.conf"
```

Expected: the final two assignments use `/home/golem/.paseo` and `0.9.1-plus.20260923-1`.

- [ ] **Step 6: Add the minimal reusable version-stamp task**

```bash
cat > "$HOME/.paseo-plus-daemon/stamp.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

: "${DESVIO_WORKTREE:?run this with: desvio run stamp}"
PASEO_CONF="${PASEO_CONF:-$(dirname "$DESVIO_CONFIG_FILE")/paseo.conf}"
# shellcheck disable=SC1090
. "$PASEO_CONF"
: "${PASEO_PACKAGE_VERSION:?set PASEO_PACKAGE_VERSION in paseo.conf}"

node - "$DESVIO_WORKTREE" "$PASEO_PACKAGE_VERSION" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [, , tree, version] = process.argv;
const packages = [
  ["packages/server/package.json", "@getpaseo/server"],
  ["packages/cli/package.json", "@getpaseo/cli"],
];
for (const [relativePath, expectedName] of packages) {
  const file = path.join(tree, relativePath);
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (pkg.name !== expectedName) throw new Error(`unexpected package at ${file}`);
  pkg.version = version;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${expectedName}=${version}`);
}
NODE
EOF
chmod +x "$HOME/.paseo-plus-daemon/stamp.sh"
bash -n "$HOME/.paseo-plus-daemon/stamp.sh"
```

Expected: `bash -n` exits with status 0.

### Task 5: Assemble, test, and compare the Debian source tree

**Files:**

- Create: `/home/golem/.paseo-plus-daemon/build-tree/`
- Create: `/home/golem/.paseo-plus-daemon/state/`
- Append: `/home/golem/paseo-plus-debian-inputs.txt`
- Do not modify: `/home/golem/.paseo/`

**Interfaces:**

- Consumes: the pinned Desvio configuration
- Produces: a gated integration tree that matches the Mac source tree

- [ ] **Step 1: Confirm the current daemon is still the stock daemon**

```bash
GLOBAL_PASEO=$(cat "$HOME/paseo-plus-global-cli-path.txt")
"$GLOBAL_PASEO" daemon status --home /home/golem/.paseo --json
```

Expected: the daemon is still running. No daemon switch has occurred.

- [ ] **Step 2: Run the Desvio build gate**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/.paseo-plus-daemon"
desvio build
```

Expected:

- Desvio creates `paseo-plus-daemon-v0-9-1` from `v0.9.1`.
- It merges `paseo-plus-topic-v0-9-1`.
- `npm ci` runs when needed.
- `npm run build:server`, `npm run typecheck`, and `npm run lint` pass.
- The current global daemon remains running.

If a conflict appears, run:

```bash
cd "$HOME/.paseo-plus-daemon"
desvio abort
```

Then stop. Do not start a conflicted or failed build.

- [ ] **Step 3: Run only the targeted feature tests**

```bash
BUILD_TREE="$HOME/.paseo-plus-daemon/build-tree"
cd "$BUILD_TREE"

npm test --workspace=@getpaseo/protocol -- \
  src/paseo-config-schema.test.ts --bail=1

npm test --workspace=@getpaseo/app -- \
  src/desktop/browser/default-url.test.ts \
  src/desktop/browser/automation/handler.test.ts \
  --bail=1
```

Expected: both targeted Vitest commands pass. Do not run the full repository test suite.

- [ ] **Step 4: Compare the assembled Git tree with the Mac build**

```bash
BUILD_TREE="$HOME/.paseo-plus-daemon/build-tree"
MAC_TREE=$(sed -n 's/^integration-tree=//p' "$HOME/paseo-plus-mac-inputs.txt" | tail -1)
DEBIAN_TREE=$(git -C "$BUILD_TREE" rev-parse 'HEAD^{tree}')
printf 'mac-tree=%s\ndebian-tree=%s\n' "$MAC_TREE" "$DEBIAN_TREE"
test "$DEBIAN_TREE" = "$MAC_TREE"
```

Expected: both tree hashes are equal. If they differ, stop. Do not stamp or start the daemon.

- [ ] **Step 5: Record the assembled Debian tree**

```bash
BUILD_TREE="$HOME/.paseo-plus-daemon/build-tree"
{
  git -C "$BUILD_TREE" rev-parse HEAD | sed 's/^/integration-commit=/'
  git -C "$BUILD_TREE" rev-parse 'HEAD^{tree}' | sed 's/^/integration-tree=/'
} | tee -a "$HOME/paseo-plus-debian-inputs.txt"
```

Expected: the integration tree equals the Mac integration tree. The integration commit may differ because Git merge metadata can differ between machines.

### Task 6: Stamp and verify the shared fork release ID

**Files:**

- Modify in disposable tree: `/home/golem/.paseo-plus-daemon/build-tree/packages/server/package.json`
- Modify in disposable tree: `/home/golem/.paseo-plus-daemon/build-tree/packages/cli/package.json`

**Interfaces:**

- Consumes: the gated, Mac-matching tree
- Produces: a daemon and CLI that both report `0.9.1-plus.20260923-1`

- [ ] **Step 1: Stamp the two runtime package manifests**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/.paseo-plus-daemon"
desvio run stamp
```

Expected:

```text
@getpaseo/server=0.9.1-plus.20260923-1
@getpaseo/cli=0.9.1-plus.20260923-1
```

- [ ] **Step 2: Verify that only the two package versions changed**

```bash
BUILD_TREE="$HOME/.paseo-plus-daemon/build-tree"
git -C "$BUILD_TREE" status --short
git -C "$BUILD_TREE" diff -- \
  packages/server/package.json \
  packages/cli/package.json
```

Expected: only the two package manifests are modified, and each diff changes only `version` to `0.9.1-plus.20260923-1`.

- [ ] **Step 3: Verify the build-tree CLI version**

```bash
BUILD_CLI="$HOME/.paseo-plus-daemon/build-tree/packages/cli/bin/paseo"
test -x "$BUILD_CLI"
"$BUILD_CLI" --version
```

Expected:

```text
0.9.1-plus.20260923-1
```

### Task 7: Persist relay disablement before the switch

**Files:**

- Modify through CLI: `/home/golem/.paseo/config.json`

**Interfaces:**

- Consumes: the current live global daemon and backed-up config
- Produces: explicit persisted `daemon.relay.enabled=false`

- [ ] **Step 1: Disable relay through the current global CLI**

```bash
GLOBAL_PASEO=$(cat "$HOME/paseo-plus-global-cli-path.txt")
"$GLOBAL_PASEO" daemon config set \
  daemon.relay.enabled false \
  --home /home/golem/.paseo
```

Expected: Paseo reports that the setting was saved and applied. Relay enablement is runtime-safe and does not require a daemon restart.

- [ ] **Step 2: Verify relay and listen configuration**

```bash
GLOBAL_PASEO=$(cat "$HOME/paseo-plus-global-cli-path.txt")
"$GLOBAL_PASEO" daemon config get daemon.relay.enabled \
  --home /home/golem/.paseo
"$GLOBAL_PASEO" daemon config get daemon.listen \
  --home /home/golem/.paseo
```

Expected:

```text
false
100.77.235.73:6767
```

Do not set `PASEO_LISTEN`. The persisted listen value is authoritative.

### Task 8: Switch the live daemon to the verified Desvio tree

**Files:**

- Read and write runtime state: `/home/golem/.paseo/`
- Create runtime log: `/home/golem/.paseo-plus-daemon/state/daemon-out.log`

**Interfaces:**

- Consumes: the stamped candidate and current global daemon
- Produces: a running fork daemon on the existing home and Tailscale listener

- [ ] **Step 1: Move to a normal SSH terminal and check for live agents**

Do not run this task from Paseo chat, a Paseo terminal, or an agent process. Open a separate SSH session to Debian, then run:

```bash
GLOBAL_PASEO=$(cat "$HOME/paseo-plus-global-cli-path.txt")
"$GLOBAL_PASEO" ls -g --json
```

Expected: inspect the output and wait until no agent turn is active. Stopping the daemon terminates provider processes and loses any in-flight turn.

- [ ] **Step 2: Run the guarded daemon swap**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/.paseo-plus-daemon"
desvio run start --no-desktop
```

Expected:

- Desvio reports the current daemon tree and the candidate tree.
- It lists running agent processes, if any.
- It asks before stopping the daemon.
- After confirmation, it stops the global daemon.
- It starts the fork with `PASEO_HOME=/home/golem/.paseo`.
- It reports that the daemon serves `~/.paseo-plus-daemon/build-tree`.

Do not pass `--yes` on the first switch. Read the process list and confirm interactively.

- [ ] **Step 3: Recover immediately if startup fails**

Run this only if `desvio run start --no-desktop` reports a startup error:

```bash
GLOBAL_PASEO=$(cat "$HOME/paseo-plus-global-cli-path.txt")
"$GLOBAL_PASEO" daemon start --home /home/golem/.paseo
"$GLOBAL_PASEO" daemon status --home /home/golem/.paseo --json
```

Then inspect both logs:

```bash
tail -n 200 "$HOME/.paseo-plus-daemon/state/daemon-out.log"
tail -n 200 /home/golem/.paseo/daemon.log
```

Expected: the global daemon returns. Do not retry the fork start until the failure is understood.

### Task 9: Verify the fork daemon before daily use

**Files:**

- Create: `/home/golem/paseo-plus-debian-active.json`

**Interfaces:**

- Consumes: the running fork daemon
- Produces: status, provider, network, Mac-client, and default-URL acceptance evidence

- [ ] **Step 1: Capture and assert daemon identity**

```bash
BUILD_CLI="$HOME/.paseo-plus-daemon/build-tree/packages/cli/bin/paseo"
STATUS_FILE="$HOME/paseo-plus-debian-active.json"
"$BUILD_CLI" daemon status --home /home/golem/.paseo --json | tee "$STATUS_FILE"

node - "$STATUS_FILE" <<'NODE'
const fs = require("node:fs");
const status = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expected = {
  home: "/home/golem/.paseo",
  listen: "100.77.235.73:6767",
  daemonVersion: "0.9.1-plus.20260923-1",
  desktopManaged: false,
  localDaemon: "running",
  connectedDaemon: "reachable",
};
for (const [key, value] of Object.entries(expected)) {
  if (status[key] !== value) {
    throw new Error(`${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(status[key])}`);
  }
}
if (status.relay?.enabled !== false) {
  throw new Error(`relay.enabled: expected false, got ${JSON.stringify(status.relay)}`);
}
console.log("daemon identity verified");
NODE
```

Expected: `daemon identity verified`.

- [ ] **Step 2: Verify the process serves the Desvio tree**

```bash
PID=$(node -e 'const s=require(process.argv[1]); process.stdout.write(String(s.pid))' \
  "$HOME/paseo-plus-debian-active.json")
DAEMON_CWD=$(readlink -f "/proc/$PID/cwd")
printf 'pid=%s\ncwd=%s\n' "$PID" "$DAEMON_CWD"
case "$DAEMON_CWD" in
  "$HOME/.paseo-plus-daemon/build-tree"/*) ;;
  *) printf '%s\n' 'wrong daemon tree' >&2; exit 1 ;;
esac
```

Expected: the daemon working directory is below `~/.paseo-plus-daemon/build-tree`.

- [ ] **Step 3: Verify provider discovery in the daemon environment**

```bash
BUILD_CLI="$HOME/.paseo-plus-daemon/build-tree/packages/cli/bin/paseo"
for provider in claude codex pi; do
  printf '\n=== %s ===\n' "$provider"
  "$BUILD_CLI" provider diagnostic "$provider" \
    --home /home/golem/.paseo \
    --json
done
```

Expected: each required provider resolves its intended executable and does not report an unavailable or broken state.

- [ ] **Step 4: Verify Tailscale and daemon health on Debian**

```bash
tailscale ip -4
curl -fsS http://100.77.235.73:6767/api/health
```

Expected: Tailscale includes `100.77.235.73`, and the health request succeeds.

- [ ] **Step 5: Verify the Mac client pair**

On the Mac:

1. Quit stock `Paseo.app` if it is open.
2. Open `Paseo Plus.app`.
3. Select the direct Debian host at `100.77.235.73:6767`.
4. Open **Settings → About** and confirm the app reports `0.9.1-plus.20260923-1`.
5. Open **Settings → the Debian host → Overview → Full status** and confirm the daemon reports `0.9.1-plus.20260923-1`.
6. Confirm existing projects, workspaces, agents, and conversations are visible.

Expected: the matched app and daemon connect through Tailscale with no local Mac daemon.

- [ ] **Step 6: Verify the default-URL feature**

Use a registered project whose root `paseo.json` contains:

```json
{
  "browser": {
    "defaultUrl": "https://studio-biro.de/"
  }
}
```

In Paseo Plus, open that project and create a manual browser tab.

Expected: the new tab opens `https://studio-biro.de/`. A project without `browser.defaultUrl` keeps the normal fallback.

### Task 10: Drill rollback and restore the fork

**Files:**

- Read: `/home/golem/paseo-plus-global-cli-path.txt`
- Reuse: `/home/golem/.paseo/`

**Interfaces:**

- Consumes: an accepted fork daemon
- Produces: a tested global fallback and a restored fork daemon

- [ ] **Step 1: Stop the fork from a normal SSH terminal**

Wait until no agent turn is active, then run:

```bash
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/.paseo-plus-daemon"
desvio run stop --keep-app
```

Expected: Desvio lists the daemon and agent processes, asks for confirmation, and stops the fork daemon. Debian has no Desktop app, so `--keep-app` narrows the operation to daemon and build-tree processes.

- [ ] **Step 2: Start the unchanged global daemon**

```bash
GLOBAL_PASEO=$(cat "$HOME/paseo-plus-global-cli-path.txt")
"$GLOBAL_PASEO" daemon start --home /home/golem/.paseo
"$GLOBAL_PASEO" daemon status --home /home/golem/.paseo --json
```

Expected: the stock daemon starts against the same home and listener. Existing state remains visible from the Mac, but manual browser tabs do not have the fork behavior when a stock client or daemon lacks it.

- [ ] **Step 3: Restore the fork daemon**

```bash
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/.paseo-plus-daemon"
desvio run start --no-desktop
```

Expected: Desvio swaps the global daemon back to the verified build tree.

- [ ] **Step 4: Repeat the identity check**

```bash
BUILD_CLI="$HOME/.paseo-plus-daemon/build-tree/packages/cli/bin/paseo"
"$BUILD_CLI" daemon status --home /home/golem/.paseo --json
```

Expected: version `0.9.1-plus.20260923-1`, home `/home/golem/.paseo`, listen `100.77.235.73:6767`, `desktopManaged: false`, and relay disabled.

### Task 11: Record daily operation and the next update path

**Files:**

- Create: `/home/golem/paseo-plus-debian-commands.txt`

**Interfaces:**

- Consumes: the tested start and rollback commands
- Produces: a small local operator record

- [ ] **Step 1: Save the daily commands**

```bash
cat > "$HOME/paseo-plus-debian-commands.txt" <<'EOF'
# Start or restore the fork after a host reboot.
cd "$HOME/.paseo-plus-daemon"
PATH="$HOME/.local/bin:$PATH" desvio run start --no-desktop

# Stop the fork. Run only from a normal SSH terminal when no agent turn is active.
cd "$HOME/.paseo-plus-daemon"
PATH="$HOME/.local/bin:$PATH" desvio run stop --keep-app

# Start the stock rollback daemon.
GLOBAL_PASEO=$(cat "$HOME/paseo-plus-global-cli-path.txt")
"$GLOBAL_PASEO" daemon start --home /home/golem/.paseo

# Inspect the fork daemon.
BUILD_CLI="$HOME/.paseo-plus-daemon/build-tree/packages/cli/bin/paseo"
"$BUILD_CLI" daemon status --home /home/golem/.paseo --json
EOF
cat "$HOME/paseo-plus-debian-commands.txt"
```

Expected: the file contains start, stop, rollback, and status commands.

- [ ] **Step 2: Use the safe sequence for the next pinned update**

For a future release:

1. Build and verify the matching Mac candidate first.
2. Copy its two record files to Debian.
3. Wait until no agent turn is active.
4. Stop the fork and start the global daemon.
5. Update the fixed base, topic ref, manifest, and release ID.
6. Run `desvio build` while the global daemon serves `/home/golem/.paseo`.
7. Run the targeted tests and compare the Mac and Debian integration tree hashes.
8. Run `desvio run stamp`.
9. Run `desvio run start --no-desktop` to switch back to the new fork.
10. Repeat the status, provider, Tailscale, Mac-pair, default-URL, and rollback checks.

Do not run `desvio build` while the fork daemon serves the build tree. Desvio's preflight must refuse that state.

## Supporting documentation

- Paseo configuration: <https://paseo.sh/docs/configuration.md>
- Paseo CLI daemon management: <https://paseo.sh/docs/cli.md#daemon-management>
- Paseo Tailscale connectivity: <https://paseo.sh/docs/connectivity.md#tailscale>
- Desvio Paseo example: <https://github.com/cleiter/desvio/tree/main/examples/paseo>
