# WP04 CLI Pin Propagation Evidence

- Generated at: 2026-03-11T01:48:29.268Z
- Temp root: /var/folders/gg/qrn_cpfn4zsbf2ytjps2hbs00000gn/T/wp04-pin-Ml4GLn
- Repo: /var/folders/gg/qrn_cpfn4zsbf2ytjps2hbs00000gn/T/wp04-pin-Ml4GLn/skills-repo
- Bundle: developer-bundle
- Config path: /var/folders/gg/qrn_cpfn4zsbf2ytjps2hbs00000gn/T/wp04-pin-Ml4GLn/distribution-config.json

## Result

- Before version: v1.0.0
- After version: v1.1.0
- Before marker: v1.0.0
- After marker: v1.1.0
- Restart count to propagate (CLI): 1
- Pin updated at: 2026-03-11T01:48:27.795Z
- After-sync duration (ms): 864
- Pass: yes

## Command Output

### pnpm exec tsx packages/skill-sync/src/cli.ts --sync --quiet
```text
(empty)
```

### pnpm exec tsx packages/skill-sync/src/cli.ts --status
```text
{
  "status": "success",
  "lastAttempt": "2026-03-11T01:48:26.965Z",
  "lastSync": "2026-03-11T01:48:26.965Z",
  "lastSuccess": "2026-03-11T01:48:26.965Z",
  "version": "v1.0.0",
  "repoUrl": "/var/folders/gg/qrn_cpfn4zsbf2ytjps2hbs00000gn/T/wp04-pin-Ml4GLn/skills-repo",
  "filesUpdated": 1,
  "modifiedFilesOverwritten": [],
  "managedFiles": {
    "proposal/SKILL.md": "95877f6baad0d12b22745cc1f5a743c679c7d826e71c185a077a3bb32660cd77"
  }
}
```

### pnpm exec tsx packages/skill-sync/src/cli.ts --sync --quiet
```text
(empty)
```

### pnpm exec tsx packages/skill-sync/src/cli.ts --status
```text
{
  "status": "success",
  "lastAttempt": "2026-03-11T01:48:28.637Z",
  "lastSync": "2026-03-11T01:48:28.637Z",
  "lastSuccess": "2026-03-11T01:48:28.637Z",
  "version": "v1.1.0",
  "repoUrl": "/var/folders/gg/qrn_cpfn4zsbf2ytjps2hbs00000gn/T/wp04-pin-Ml4GLn/skills-repo",
  "filesUpdated": 1,
  "modifiedFilesOverwritten": [],
  "managedFiles": {
    "proposal/SKILL.md": "b948e16a2652b9ecf907379f9f5c373f1a9c9d56363f615383d050174074b6e1"
  }
}
```
