# Changelog

## 0.2.0

- Declare the host-provided TUI peer used by the custom renderers.
- Add destination headers, expandable message previews and pi-lens-style blue acknowledgements, with compact agent feedback.
- Avoid duplicate tool-result toasts while retaining shared-API error notifications; warn against retrying both destinations after delivery failures.
- Rename the package and repository to `pi-messages`, preserving the `send_message` tool and `pi.messaging` shared API.

## 0.1.0

- Add Discord and Slack webhook transport, the `send_message` tool, and the shared `pi.messaging` service.
- Bound requests to five seconds, support cancellation and shutdown cleanup, and return credential-safe structured failures.
