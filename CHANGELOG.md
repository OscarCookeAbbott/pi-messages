# Changelog

## Unreleased

- Rename the package and repository to `pi-messages`, preserving the `send_message` tool and `pi.messaging` shared API.

## 0.1.0

- Add Discord and Slack webhook transport, the `send_message` tool, and the shared `pi.messaging` service.
- Bound requests to five seconds, support cancellation and shutdown cleanup, and return credential-safe structured failures.
