---
title: Desktop Shell Architecture Overview
doc_type: architecture
status: active
owner: desktop-shell
last_verified: 2026-04-06
source_of_truth: true
related:
  - docs/desktop-shell/README.md
  - docs/superpowers/specs/2026-04-06-desktop-shell-architecture-refactor-design.md
---

# Desktop Shell Architecture Overview

This document answers: how `desktop-shell` is currently organized.

## Application Layers

- App shell and routing
- Feature modules
- Shared UI and utility layer
- Desktop integration layer

## State Ownership

- Router owns navigational identity.
- TanStack Query owns remote state.
- Zustand owns local application state under `apps/desktop-shell/src/state/`.
- Persisted Zustand domains currently include `settings`, `code-tools`, `minapps`, and `tabs`.
- Permission prompts use a dedicated in-memory Zustand store and are not persisted.

## Change Policy

If these boundaries change, update this document in the same change set.
