# Explicit profiles

Add profiles to the consuming app's `scripts/worktree.config.json`:

```json
{
  "profiles": {
    "example": {
      "hooks": {
        "afterPrepare": [
          {
            "name": "prepare",
            "command": ["node", "scripts/example/prepare.mjs"]
          }
        ],
        "beforeImport": [
          {
            "name": "credentials",
            "command": ["node", "scripts/example/credentials.mjs"],
            "timeoutMs": 30000
          }
        ]
      }
    }
  }
}
```

Run `node scripts/worktree/cli.mjs setup --profile example`. Selection is per
invocation; omission runs no profile commands. `start --profile example` runs
only `beforeStart` hooks, after ownership/config checks and before service startup.
Selection is also forwarded by `setup --path ... --branch ... --profile example`.
All declarations are validated, including unselected profiles, before hooks run.

Setup phases, under the existing checkout lock:

1. `afterPrepare`: after identity, port allocation and managed environment files.
   Runs even with `--prepare-only`. Backend-free setup runs only this phase.
2. `beforeImport`: after anonymous backend bootstrap and ownership validation,
   before `convex env set --from-file .worktree/backend.env`.
3. `afterPush`: after environment import and successful final push.

Repeated setup reruns these phases; scripts must reuse external resources safely.
Hooks execute sequentially and must exit. A named failure stops subsequent hooks
and lifecycle steps. Commands are executable plus literal argv, with no shell.
Paths are relative to the worktree root. No directory scanning occurs; adding an
unlisted helper file has no effect. Existing editor `prepareCommand` integration
continues to invoke setup as before; no new editor execution policy is introduced.
Long-running services use the separate declarations below.

Each child receives `WORKTREE_CONTEXT`, a JSON object with `version`, `profile`,
`phase`, `id`, `root`, `backend`, `frontend`, `stateDirectory`, `environmentFile`,
and `ports` (`web`, `cloud`, `site`; empty in backend-free mode). Convex children
retain the isolated HOME and scrubbed Convex environment. Consumer scripts must
keep credentials in their own repository's ignored state and must not log them.
A credentials hook can read this context and update `environmentFile`; the next
import reads that file. The two scripts above form a minimal preparation/import
example; provider-specific provisioning belongs in the consumer repository.

The default timeout is 180 seconds; `timeoutMs` is an integer from 1 to 3600000.
Timeout or runner SIGINT/SIGTERM sends SIGTERM to the direct child, then SIGKILL
after two seconds if needed. Hooks must not detach processes or leave background
children. Interruptions fail the phase even if the child exits zero.

## Managed services

A profile can also declare named services, separate from hooks:

```json
{
  "profiles": {
    "example": {
      "services": {
        "listener": {
          "command": ["node", "scripts/example/listener.mjs"],
          "readiness": {
            "command": ["node", "scripts/example/wait-for-listener.mjs"],
            "timeoutMs": 30000
          }
        }
      }
    }
  }
}
```

Run `start --profile example`. All declared services are required for that
profile. Each readiness command must exit zero only when its service is usable;
it can poll a local endpoint or an identity-specific readiness file. A nonzero
exit is an immediate failure. Readiness is mandatory and bounded to 1–120000 ms.
No checks are inferred from names or directories. Scripts must clear stale
readiness markers or verify the current process identity themselves.

Startup order is: explicit `beforeStart` hooks, backend readiness (if enabled),
then services in declaration order with each readiness check, then frontend
startup (if requested). Start reports success after all service checks pass.
Setup still runs only setup hooks; it does not start auxiliary services.

Unlike hook selection, the service profile selected by start is saved in owned
worktree state. `start` after `stop` reuses it. Omitted selection does not run
hooks; `start --profile example` reruns only `beforeStart`, never setup phases.
Repeated start while active reuses the supervisor and children without rerunning
hooks. Stop before selecting a different active profile. To start without
services, select an explicit empty profile after stop. Changing declarations
requires stop/start; no automatic restart or dependency graph is provided.

Service and readiness commands receive the same `WORKTREE_CONTEXT` contract with
`phase: "service"`. Their working directory is the worktree root and arguments
are literal. The supervisor records each service PID, readiness and failure in
`.worktree/services.json`, tied to the worktree ID. These PIDs are evidence only:
shutdown signals child objects owned by the checked supervisor, never PID lists,
ports or names. `status` prints JSON and exits nonzero for a named service failure.
An unexpected required-service exit fails the profile and stops sibling children.

Stop sends SIGINT to owned children, then SIGKILL after two seconds if required.
The supervisor waits for child closure. Readiness timeout kills its probe and
fails startup; failure stops already-started children. Teardown also stops owned
services. Stop and teardown preserve profile selection, consumer credentials and
remote associations. Explicit cleanup removes managed state; consumer files and
remote resource deletion remain the consumer's responsibility. Services must stay
in the foreground and must not detach untracked descendants. There is no remote
resource cleanup policy in this toolkit.

The fixture tests in `services.test.mjs` provide a runnable generic two-worktree
demonstration: delayed readiness, distinct contexts, repeated start, one-worktree
stop, restart, teardown, startup timeout and runtime failure. They use backend-free
fixtures; the toolkit itself continues to create no backend or frontend.
