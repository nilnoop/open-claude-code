---
title: Desktop Shell Operations
doc_type: operation
status: active
owner: desktop-shell
last_verified: 2026-04-06
source_of_truth: true
related:
  - docs/desktop-shell/README.md
  - docs/desktop-shell/architecture/overview.md
---

# Desktop Shell Operations

This document answers: how to maintain and verify `desktop-shell`.

## Required Updates

- Update architecture docs when product structure changes.
- Update tokens when shared UI or functional language changes.
- Update `AGENTS.md` only when navigation or documentation rules change.

## Verification Commands

- `cd apps/desktop-shell && npm run build`
- `cd apps/desktop-shell/src-tauri && cargo check`
- `git diff --check`
