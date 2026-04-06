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
- Update `apps/desktop-shell/src/state/` docs and storage behavior together when adding or removing a persisted domain.

## Verification Commands

- `cd apps/desktop-shell && npm run build`
- `cd apps/desktop-shell/src-tauri && cargo check`
- `git diff --check`

## State Verification

- Verify local state consumers import from `@/state/*` instead of `@/store`.
- Keep Router, TanStack Query, and Zustand ownership boundaries aligned with `docs/desktop-shell/architecture/overview.md`.
- When changing persistence, preserve compatibility with the legacy `persist:open-claude-code` payload or document the migration explicitly.
