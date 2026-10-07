# Deferred durable storage boundary

Historical setup scope or dated inventory. Retained for provenance; this is not the current assignment or proof of installed acceptance. See [current implementation](IMPLEMENTATION_STATUS.md), [storage retention](STORAGE_RETENTION.md), and [journal compatibility](UPDATE_LIFECYCLE.md#journal-compatibility-and-rollback).

S0 opens no database and acknowledges no job. M1 must select and qualify an exact Node/SQLite binding against the pinned runtime, use a service-owned local-disk SQLite WAL journal, and define checked migration/version transitions before admission. A file or schema-shaped fixture is not durable admission.

The one installed service will own operation admission, scheduling, events, subprocess supervision, retries and cancellation. The native platform layer owns supported macOS registration and client interaction, without creating another scheduler. CLI and remote callers invoke that same service through bounded authenticated interfaces.

Acceptance must bind immutable source, destination, policy, caller authority and request identity before returning `accepted`. The service must retain intent and uncertain effects across non-atomic database/Git/device/file boundaries, reconcile before repeating mutations, and preserve project-specific policies. Installed releases must run independently of source checkouts. The remaining M0 installed-payload boundary precedes M1; neither is implemented by S0.
