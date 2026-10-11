# Host notes — Windows build machine

These notes record problems of the build host, not of this game. Read them
before you spend time on a tool that fails in a strange way. Each item below
was found and confirmed on this machine.

The host is Windows 11. The user profile is `C:\Users\Lucas Monteiro`. The
space in the profile name is the cause of two of the three problems.

## 1. Use `engine: "cli"` for `claude_local` agents

An agent that uses the default ACP engine cannot start on this host. The
launcher starts `claude-agent-acp.cmd` without quotation marks around the path,
so Windows tries to start a program named `C:\Users\Lucas`. The run fails with
`spawn C:\Users\Lucas ENOENT` before the agent gets any work.

Set `adapterConfig.engine` to `"cli"` when you make a new agent. The CLI engine
does not use the ACP launcher.

## 2. `git` on `PATH` is a broken shim — call `git.exe` directly

Paperclip puts a managed launcher directory at the front of `PATH`. The
launcher file is named `git`, with no file extension, and it looks for the real
binary with the bare name `git`:

```js
const executable = originalPath.map(p => path.join(p, program)).find(p => {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
});
```

On Windows the real binary is `git.exe`, so no directory on `PATH` matches. The
launcher writes `Paperclip: requested GitHub command is not installed.` and
exits with code 127. It never reaches the credential broker.

Call the real binary with its full path instead:

```powershell
& "C:\Program Files\Git\cmd\git.exe" status
```

## 3. Get push credentials from the broker, not from the environment

Plain `git push` cannot authenticate on this host:

- `GITHUB_TOKEN` and `GIT_ASKPASS` are empty.
- `GIT_CONFIG_GLOBAL` is `/dev/null`, so no credential helper loads.
- The Windows credential store holds no GitHub entry.
- `gh` is not installed.

The broker is healthy. Ask it for credentials directly, with the same headers
the launcher uses:

```
POST $PAPERCLIP_GITHUB_BROKER_URL/runtime-tools/github/credentials
  authorization: Bearer $PAPERCLIP_API_KEY
  x-paperclip-github-capability: $PAPERCLIP_GITHUB_BROKER_TOKEN
  content-type: application/json
  body: {}
```

A good answer has `status: "available"` and an `env` object. Put those
variables in the environment of the push command, then push with the real
`git.exe`.

## Shell note

The Bash tool on this host has no coreutils on its `PATH` — `env`, `grep`,
`sed` and `node` all fail with exit code 127. Use the PowerShell tool for
shell work.

## Status

All three problems are reported upstream on GAM-13. Delete the matching
section here when a Paperclip release fixes it. Until then, treat this file as
the shortest path around each one.
