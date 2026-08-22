---
name: AI Gateway fallback
description: Managed AI provisioning may be unavailable in a new workspace, so generation needs an explicit local fallback.
---

The study-kit backend must not assume AI Gateway provisioning succeeds; it should use structured AI generation when the managed variables exist and return a clearly bounded material-derived starter otherwise.

**Why:** AI integration setup can return an account-upgrade state even though the app itself is otherwise runnable.

**How to apply:** Keep fallback output schema-valid and visible in the UI as a recoverable path; never silently drop a user's uploaded material.