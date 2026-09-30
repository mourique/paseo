# Desvio daily fork deployment

## Goal

Run one pinned fork of Paseo as the daily installation:

- The Debian machine runs the standalone daemon and all agents.
- The Mac runs a forked Desktop client.
- Manual browser tabs use `browser.defaultUrl` from each project's `paseo.json`.
- The Mac reaches Debian directly through Tailscale.
- Existing daemon state stays in `/home/golem/.paseo`.
- Stock Paseo remains available on both machines as a rollback path.

This design uses [Desvio](https://github.com/cleiter/desvio) to assemble the fork from an upstream stable tag and the default-URL topic branch. It adapts Desvio's Paseo example instead of creating a separate release system.

## Topology

```text
Mac: Paseo Plus.app
  remote-only Desktop client
  no bundled local daemon
          |
          | direct WebSocket over Tailscale
          v
Debian: 100.77.235.73:6767
  forked standalone daemon
  PASEO_HOME=/home/golem/.paseo
  providers, agents, workspaces, and project files
```

The Debian daemon is not Desktop-managed. It keeps the existing service user, Node installation, provider environment, home, server identity, and project paths.

The relay is disabled. Tailscale membership and ACLs are the access boundary. The daemon does not require a Paseo password. Any tailnet device that can reach the listener can control the daemon, so the tailnet policy must allow only trusted devices.

## Source assembly

Keep a Paseo checkout and a separate Desvio config directory on each machine. Both Desvio configurations use:

- the same selected upstream stable tag as `DESVIO_BASE`;
- the same resolved default-URL feature branch commit in `manifest.txt`;
- distinct local Desvio integration branches and worktrees.

Record the base tag, base commit, topic commit, and resulting Git tree hash for each installed pair. Confirm that the topic branch's upstream fork point is an ancestor of the selected stable tag. This prevents a merge from carrying unrelated upstream commits into a pinned release.

Assign one explicit fork release ID to the pair, such as `0.9.1-plus.20260923-1`. Pass it to the Mac package task as `PASEO_PACKAGE_VERSION`. After the Debian gate passes, a deployment task stamps `packages/server/package.json` and `packages/cli/package.json` with the same ID before starting the daemon. The stamped manifests stay in the active tree because the daemon reads its version from `packages/server/package.json` at runtime. The next Desvio build resets the disposable tree before creating the next candidate.

The initial base candidate is `v0.9.1`. The current feature fork point is its ancestor. Recheck this condition for each later stable tag.

Each machine builds locally. Do not copy `node_modules` or native build output between macOS and Debian.

## Debian daemon

Use Desvio's Paseo build and verification hooks:

- install dependencies with `npm ci` when the lockfile changes;
- build server packages from `dist`;
- run repository typecheck and lint gates;
- refuse to rebuild while a live daemon serves the Desvio tree.

Run the verified daemon directly from the Desvio build tree with the real home. Stamp the shared fork release ID after verification, then start it without Desktop. Do not set `PASEO_LISTEN`; the persisted config remains authoritative and keeps `100.77.235.73:6767`.

Keep the existing global npm installation unchanged and stopped while the fork runs. It is the Debian rollback runtime.

This choice requires downtime during later Debian rebuilds. Stop the active daemon before Desvio rewrites its tree. A daemon stop terminates provider processes and loses an in-flight turn, so update only when no turn is active.

## Mac Desktop

Adapt Desvio's Apple Silicon Paseo packaging task to build `Paseo Plus.app` beside stock `Paseo.app`.

The custom bundle:

- uses the shared fork release ID;
- uses a separate product name, bundle ID, and badged icon;
- uses ad-hoc signing for local use and passes deep signature verification;
- contains no `app-update.yml`, which prevents the official updater from replacing the fork;
- shares Paseo's existing Desktop user-data directory, including saved hosts and conversations;
- sets `manageBuiltInDaemon` to `false` and does not keep a local daemon running.

The two apps share Electron's single-instance lock and cannot run at the same time. The shared Desktop setting also makes stock Paseo remote-only, which matches this topology.

Configure the Debian host as a direct connection to `100.77.235.73:6767`, with SSL and Paseo password authentication off. Tailscale supplies transport encryption.

## Default-URL data flow

1. The Debian daemon reads `browser.defaultUrl` from the workspace `paseo.json`.
2. It projects the value as the optional `browserDefaultUrl` workspace field.
3. Paseo Plus stores the field in its workspace descriptor.
4. A manually created browser tab uses that URL as its initial URL.
5. A project without the field uses the existing fallback.

The field stays optional for protocol compatibility. Stock clients can connect to the fork daemon but do not use the field for manually created browser tabs.

## Initial deployment

1. Configure Desvio on both machines with the same recorded inputs and fork release ID.
2. Build and verify the Debian candidate while the current global npm daemon stays live.
3. Build Paseo Plus with the shared release ID and verify that the updater configuration is absent.
4. Install Paseo Plus beside stock Paseo and make it remote-only.
5. Select a quiet time with no active agent turn.
6. Stop the global Debian daemon.
7. Stamp the shared release ID into the verified Debian tree.
8. Persist relay disablement and start the Desvio daemon against `/home/golem/.paseo`.
9. Connect Paseo Plus through Tailscale.
10. Run the status, state, provider, version, and default-URL checks.
11. Complete the rollback drill before adopting the pair for daily use.

## Pinned update flow

1. Select a newer upstream stable tag and assign the next fork release ID.
2. Resolve and record the base and topic commits.
3. Confirm the feature branch does not carry unrelated upstream commits.
4. Build and verify the Mac candidate without changing the installed app.
5. Stop the Debian daemon when no turn is active.
6. Rebuild and verify the Debian Desvio tree.
7. If the gate fails, start the unchanged global npm daemon and investigate offline.
8. If the gate passes, stamp the shared release ID and start the new fork daemon.
9. Install and open the Mac candidate with that release ID.
10. Repeat the acceptance checks.

Do not update one side for daily use without a verified candidate for the other side.

## Rollback

On Debian, stop the Desvio daemon and start the unchanged global npm daemon against `/home/golem/.paseo`.

On Mac, quit Paseo Plus and open stock Paseo. Stock Paseo uses the same saved Debian host and state.

Rollback restores access but not the custom manual default-URL behavior. Do not replace, migrate, or delete `/home/golem/.paseo` during deployment or rollback.

## Failure handling

A failed Desvio build does not become the daily daemon. If startup fails, inspect `/home/golem/.paseo/daemon.log` and use the global npm fallback. Do not restart repeatedly.

After each daemon start, verify:

- `desktopManaged` is `false`;
- home is `/home/golem/.paseo`;
- listen is `100.77.235.73:6767`;
- the app and daemon both report the shared fork release ID;
- Claude, Codex, and Pi are available;
- relay is disabled.

If Paseo Plus fails, use stock Paseo. If the installed app and daemon do not match the recorded pair, stop the rollout and restore a known pair. Do not alter persisted protocol or agent data to force compatibility.

## Verification and acceptance

Run these build gates on the integration trees:

- `npm run typecheck`;
- `npm run lint`;
- targeted protocol, daemon, store, and browser default-URL tests.

Verify on Mac that packaging completes, the bundle passes deep signature verification, and no updater configuration exists.

The daily pair is accepted when:

1. Paseo Plus starts without a local daemon.
2. It reconnects to Debian through Tailscale.
3. Existing projects, workspaces, agents, and conversations remain visible.
4. A project with an HTTP(S) `browser.defaultUrl` opens that URL in a new manual browser tab.
5. A project without the field keeps the existing fallback.
6. Invalid and non-HTTP(S) values fail project-config validation.
7. Mac app relaunch preserves the host and behavior.
8. Debian daemon restart preserves home, server identity, state, and providers.
9. Relay remains disabled after restart.
10. The stock rollback path works, and the fork pair can be restored afterward.

Record the exact successful commands, paths, shared release ID, and commit identities with the installed pair.
