# Contributing

Use Node 22.19 or newer. Install and verify from this directory:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm pack --dry-run
```

Keep Pi and typebox host-provided peer dependencies, not runtime dependencies. Tests must not call real Slack or Discord webhooks. Never include webhook URLs, credentials or personal session contents in reports or fixtures.

Keep changes focused and cover changed behaviour with deterministic tests. Before releasing, update the version and lockfile, add a changelog entry, and run the checks. Confirm npm scope ownership and availability before publishing.
