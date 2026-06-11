# Distribution Config API Contract (WP04 T020)

This is the contract expected from the control plane endpoint (joyus-ai) when implemented.

## GET /api/distribution/config

Response:

```json
{
  "schema_version": "1",
  "default_version": "v1.0.0",
  "bundles": {
    "pm-bundle": { "version": "v1.0.0" },
    "developer-bundle": { "version": "v1.0.0" },
    "partner-bundle": { "version": "v1.0.0" },
    "full-bundle": { "version": "v1.0.0" }
  },
  "updated_at": "2026-03-10T00:00:00Z",
  "updated_by": "admin@example.com"
}
```

## PUT /api/distribution/config

Request body: same schema as GET response.  
Expected behavior: atomic update, audit logging of `updated_by` and timestamp.

## Current Repo Implementation

Until joyus-ai endpoint is ready, `skill-sync` reads local config file:

- [distribution-config.json](../../config/distribution-config.json)

or an explicit URL via `--distribution-config-url`.
