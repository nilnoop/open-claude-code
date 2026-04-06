---
title: Desktop Shell Zustand Migration Design
doc_type: spec
status: active
owner: desktop-shell
last_verified: 2026-04-06
related:
  - docs/desktop-shell/README.md
  - docs/desktop-shell/architecture/overview.md
  - docs/superpowers/specs/2026-04-06-desktop-shell-architecture-refactor-design.md
---

# Desktop Shell Zustand Migration Design

**Goal**

Migrate `apps/desktop-shell` from Redux Toolkit + `react-redux` + `redux-persist` to Zustand while preserving the architecture work already completed:

- Router remains the owner of navigation identity
- TanStack Query remains the owner of remote data
- Zustand becomes the owner of the remaining local UI and host state

The migration should remove Redux without reintroducing a monolithic state layer and without changing Rust or backend API contracts.

**Scope**

This design applies only to `apps/desktop-shell`.

In scope:

- replacing `@reduxjs/toolkit`
- replacing `react-redux`
- replacing `redux-persist`
- migrating the remaining local state domains to Zustand
- updating app bootstrap and persistence wiring
- updating architecture and operations docs after migration

Out of scope:

- redesigning Router structure
- redesigning TanStack Query ownership
- changing backend API contracts
- changing Tauri integration boundaries
- broad UI redesign

## Current State

The previous frontend refactor already reduced Redux to local concerns. The remaining Redux store still owns these domains:

- `tabs`
- `settings`
- `ui`
- `minapps`
- `codeTools`
- `permissions`

This means the migration target is now much smaller and more appropriate for Zustand than it was before the refactor.

## Why Migrate Now

The project no longer needs Redux for normalized remote state or large cross-feature orchestration. The remaining state mostly consists of:

- local UI toggles
- persisted user preferences
- shell/session host coordination
- code-tools form state

For this profile, Zustand has three advantages:

1. lower wiring overhead than Redux Toolkit + `react-redux`
2. finer-grained store composition without rebuilding a global root reducer
3. simpler persistence replacement once the persisted surface is narrowed

The migration is now viable because the harder part, reducing bad ownership, is already done.

## Migration Approach

Use a **gradual migration**, not a big-bang rewrite.

The migration should:

1. introduce Zustand infrastructure first
2. migrate one domain at a time
3. keep Router and Query untouched
4. remove Redux only after all consumers have moved

This minimizes regression risk and keeps verification local to each domain.

## Target State Model

### Router

Router continues to own:

- page identity
- route-level selection
- navigational semantics

Zustand must not take back route truth.

### TanStack Query

TanStack Query continues to own:

- remote data
- cache invalidation
- server-derived entities

Zustand must not become a shadow cache for remote payloads.

### Zustand

Zustand owns only:

- durable local preferences
- shell-local interaction state
- host coordination state that is not route truth
- code-tools local form/configuration state

## Store Topology

Do not build a new Redux-shaped root store inside Zustand.

Instead, create separate domain stores under a dedicated state layer, for example:

- `src/state/settings-store.ts`
- `src/state/ui-store.ts`
- `src/state/permissions-store.ts`
- `src/state/code-tools-store.ts`
- `src/state/minapps-store.ts`
- `src/state/tabs-store.ts`

Optional shared helpers:

- `src/state/store-helpers.ts`
- `src/state/persist.ts`

Each store should expose:

- its local state
- actions
- a small number of stable selectors/hooks where useful

Cross-store reads should be minimized. When they are needed, they should stay explicit and local.

## Persistence Strategy

Replace `redux-persist` with Zustand persistence only where persistence is still justified.

### Persisted domains

Likely persisted:

- `settings`
- `codeTools`

Possibly persisted only if still justified after review:

- parts of `tabs`
- parts of `minapps`

Not persisted:

- ephemeral UI toggles
- permission prompt session state
- route-derived state

### Migration constraints

The current Redux layer includes two important persistence behaviors that must not be lost:

1. settings sanitization
   - secrets such as API keys must not be persisted
2. code-tools normalization
   - persisted tool/model/env state must be normalized back to current valid defaults

These behaviors must be reimplemented in Zustand persistence middleware or custom storage wrappers.

## Recommended Migration Order

Migrate from lowest coupling to highest coupling.

### Phase 1: Foundation

Add Zustand and introduce a state folder plus persistence helpers.

No behavior change yet.

### Phase 2: Low-coupling stores

Migrate first:

- `permissions`
- `ui`

These stores are small, mostly local, and easy to verify.

### Phase 3: Form and preference stores

Migrate next:

- `codeTools`
- `settings`

This phase includes persistence replacement and requires extra verification.

### Phase 4: Shell coordination stores

Migrate last:

- `minapps`
- `tabs`

These stores touch shell rendering, tab lifecycle, and embedded app coordination, so they carry the highest regression risk.

### Phase 5: Redux removal

Remove only after all consumers are migrated:

- `src/store/index.ts`
- `src/store/slices/*`
- `Provider`
- `PersistGate`
- `useAppDispatch`
- `useAppSelector`
- Redux dependencies in `package.json`

## Consumer Migration Rules

When migrating a store:

1. create the Zustand store
2. move the domain actions
3. replace `useAppSelector(...)`
4. replace `useAppDispatch()` + action dispatch calls
5. run build verification

Do not migrate all consumers first and define stores later. The store contract should exist before replacing call sites.

Do not preserve Redux-like action creators unless they still improve clarity. Zustand should use direct domain methods where practical.

## Risks

### 1. Persistence behavior drift

The biggest functional risk is changing what gets saved or restored.

Particular attention:

- secret stripping in `settings`
- default selection fallback in `codeTools`

### 2. Shell lifecycle regressions

`tabs` and `minapps` affect shell behavior and active view coordination. These areas can regress through:

- active tab switching bugs
- stale minapp state
- broken keep-alive behavior
- title synchronization issues

### 3. Hidden Redux assumptions

Some components may implicitly rely on:

- dispatch semantics
- stable reference identity
- broad rerender behavior

Zustand migration should verify behavior, not just types.

## Verification Strategy

Verification should happen per migration phase, not only at the end.

Required checks after each domain migration:

- `cd apps/desktop-shell && npm run build`

Required checks before removing Redux:

- `cd apps/desktop-shell && npm run build`
- `cd apps/desktop-shell/src-tauri && cargo check`

Behavior-focused checks should also cover:

- theme and settings restore
- permission mode changes
- code-tools model/tool selection persistence
- tab switching and tab closing
- minapp open/close behavior

## Documentation Follow-up

After the migration lands, update:

- `docs/desktop-shell/architecture/overview.md`
- `docs/desktop-shell/operations/README.md`

The resulting architecture should describe Zustand as the owner of local client state.

## Success Criteria

The migration is successful if:

- `apps/desktop-shell` no longer depends on Redux Toolkit, `react-redux`, or `redux-persist`
- Router still owns navigation identity
- TanStack Query still owns remote data
- Zustand stores are split by domain rather than centralized as a new root store
- persistence behavior is preserved where intended
- the app builds successfully after the migration
