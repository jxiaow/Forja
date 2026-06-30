---
name: scp-no-shell-quoting
description: SCP remote paths must NOT use shell quoting (quoteForRemoteShell) — SCP passes paths directly to the remote subsystem, quotes become part of the filename
source: auto-skill
extracted_at: '2026-06-25T16:10:14.284Z'
---

# SCP Remote Paths: No Shell Quoting

## The Bug

When uploading files via SCP, wrapping the remote path in shell quotes (`'...'`) causes the remote SCP subsystem to interpret the quotes as literal characters in the filename:

```
scp: dest open "'/home/user/path/file.txt'": No such file or directory
```

Note the single quotes INSIDE the error path — they're part of the filename the remote tries to open.

## Why

- **SSH commands** (`ssh host 'rm -f /path'`): The command string is passed through the remote shell, so shell quoting IS needed to handle spaces/special chars.
- **SCP paths** (`scp local host:'/path/file'`): The remote path is passed directly to the remote SCP subsystem, NOT through a shell. Quotes are NOT interpreted as shell metacharacters — they become literal characters in the path.

## Rule

```typescript
// WRONG: shell quoting on SCP remote path
const dest = `${sshTarget(server)}:${quoteForRemoteShell(remoteFile)}`;
// Produces: host:'/path/file'  →  remote tries to open '/path/file' (with quotes)

// CORRECT: raw path for SCP
const dest = `${sshTarget(server)}:${remoteFile}`;
// Produces: host:/path/file  →  remote opens /path/file
```

## Where This Applies

- `core/sshTransport.ts` — `scpUpload()`: remote file path for SCP upload
- `core/sshTransport.ts` — `deleteRemoteFile()`: uses SSH `rm -f`, so DOES need `quoteForRemoteShell`
- `core/sshTransport.ts` — `ensureRemoteDir()`: uses SSH `mkdir -p`, so DOES need `quoteForRemoteShell`

**Summary**: SCP = no quoting. SSH commands = quoting needed.
