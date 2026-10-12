# Host notes — Windows build machine

These notes record problems of the build host, not of this game. Read them
before you spend time on a tool that fails in a strange way. Each item below
was found and confirmed on this machine.

The host is Windows 11. The user profile is `C:\Users\Lucas Monteiro`. The
space in the profile name is the cause of two of the four problems.

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

A good answer has `status: "available"` and an `env` object.

Do not try to copy the whole `env` object into your shell. Some of its
`GIT_CONFIG_VALUE_*` entries are empty strings, and PowerShell deletes an
environment variable when you set it to an empty string. `GIT_CONFIG_COUNT`
then counts more pairs than exist and every later `git` call dies with
`missing config value GIT_CONFIG_VALUE_0`.

This recipe works. Clear the inherited git settings, then push to a URL that
carries the token:

```powershell
$env:GIT_CONFIG_GLOBAL = $null; $env:GIT_CONFIG_SYSTEM = $null
$env:GIT_CONFIG_COUNT = $null; $env:GIT_CONFIG_NOSYSTEM = $null
$env:GIT_SSH_COMMAND = $null; $env:GIT_ASKPASS = $null
$tok = $r.env.GITHUB_TOKEN
& $git push "https://x-access-token:$tok@github.com/lmonteco/pokemon-game.git" "HEAD:refs/heads/main"
```

Take `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and
`GIT_COMMITTER_EMAIL` from the same `env` object before you commit — or set
them yourself. Either way see section 4: without them every commit fails.

A `credential.helper=store --file=<path>` helper does **not** work here. Git
treats the helper string as a shell command, so the backslashes in a Windows
path are eaten and the helper never answers. Do not spend time on it.

Hide the token when you print command output: `$out.Replace($tok, '<token>')`.

## 4. `git commit` fails with "empty ident name" — clear the env vars

Every commit fails with:

```
fatal: empty ident name (for <>) not allowed
```

even when `git config user.name` and `user.email` are both set locally. The
cause is that the harness exports the identity variables as **empty strings**:

```
GIT_AUTHOR_NAME=      GIT_COMMITTER_NAME=
GIT_AUTHOR_EMAIL=     GIT_COMMITTER_EMAIL=
```

An empty env var still counts as set, and it overrides `git config`, so
configuring the repo has no effect. `GIT_CONFIG_GLOBAL=/dev/null` and
`GIT_CONFIG_NOSYSTEM=1` are also exported, so there is no global config to
fall back on either — the repo-local config is the only one git will read.

Set all four in the session before committing:

```powershell
$env:GIT_AUTHOR_NAME="Forge"; $env:GIT_AUTHOR_EMAIL="forge@deepwild.local"
$env:GIT_COMMITTER_NAME="Forge"; $env:GIT_COMMITTER_EMAIL="forge@deepwild.local"
```

They do not persist between PowerShell tool calls, so set them in the **same**
call as the `git commit`. Check with `git var GIT_AUTHOR_IDENT` — it fails the
same way, which makes it a one-command test for this problem.

## Shell note

The Bash tool on this host has no coreutils on its `PATH` — `env`, `grep`,
`sed` and `node` all fail with exit code 127. Use the PowerShell tool for
shell work.

## Status

All four problems are reported upstream on GAM-13. Delete the matching
section here when a Paperclip release fixes it. Until then, treat this file as
the shortest path around each one.
