---
name: dangling-reference-on-delete
description: When deleting an entity (server, target, config), all references to it in other stores must be cleared — dangling IDs cause silent failures downstream
source: auto-skill
extracted_at: '2026-07-15T14:15:54.136Z'
---

# Delete Entity Must Clear All References

When a user deletes an entity (server, target, config entry, etc.), ALL references to that entity's ID in other stores must be found and cleared. A dangling reference causes silent failures when downstream code tries to look up the deleted entity.

## The Bug Pattern

```typescript
// server remove: deletes the server but doesn't clear references
function runServerRemove(id: string): ServerResult {
    removeServer(id);  // Server deleted from serverStore
    // BUG: remote.selectedServer might still point to this id
    // BUG: sync.selectedServer might still point to this id
    return { ok: true, ... };
}

// Later: status/remote/sync commands try getServerById(selectedServer) → null
// User sees confusing "server not found" errors with no explanation
```

## The Fix

```typescript
function runServerRemove(id: string): ServerResult {
    removeServer(id);

    // Clear dangling references in all stores
    const remote = loadRemoteSettings(workspace);
    if (remote.selectedServer === id) {
        remote.selectedServer = undefined;
        saveRemoteSettings(workspace, remote);
    }

    const sync = loadSyncSettings(workspace);
    if (sync.selectedServer === id) {
        sync.enabled = false;
        sync.selectedServer = undefined;
        saveSyncSettings(workspace, sync);
    }

    return { ok: true, ... };
}
```

## Common Reference Chains

| Deleted Entity | Stores that may reference it |
|---------------|------------------------------|
| Server | `remote.selectedServer`, `sync.selectedServer`, `remote.remotePaths[serverId]`, `sync.remotePaths[serverId]` |
| Target | `workspaceStore.activeTarget`, build state files, run state files |
| Workspace/Workroot | Global workroot registry, cached configs |
| Config file | Other config files that import/reference it |

## Rules

1. **Before deleting, grep for the entity's ID across all stores** — any store that holds a reference must be checked
2. **Clear references, don't just delete the entity** — `selectedServer = undefined`, remove from maps, etc.
3. **If the deleted entity was the "active" or "selected" one, clear the active pointer** — `activeTarget`, `selectedServer`, etc.
4. **Clean up per-entity data** — if `remotePaths[serverId]` exists, remove that entry too
5. **Warn the user if references were cleared** — add an info diagnostic: "Server X was the active sync server; sync has been disabled"

## Audit Checklist

When reviewing a delete/remove command:

- [ ] What stores hold references to the deleted entity's ID?
- [ ] Is the "active/selected" pointer cleared if the deleted entity was active?
- [ ] Are per-entity data maps (like `remotePaths[id]`) cleaned up?
- [ ] Is the user informed about cleared references?
- [ ] Are there downstream commands that will break if references aren't cleared?
