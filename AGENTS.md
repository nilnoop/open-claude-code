<!-- BEGIN COMPOUND CODEX TOOL MAP -->
## Compound Codex Tool Mapping (Claude Compatibility)

This section maps Claude Code plugin tool references to Codex behavior.
Only this block is managed automatically.

Tool mapping:
- Read: use shell reads (cat/sed) or rg
- Write: create files via shell redirection or apply_patch
- Edit/MultiEdit: use apply_patch
- Bash: use shell_command
- Grep: use rg (fallback: grep)
- Glob: use rg --files or find
- LS: use ls via shell_command
- WebFetch/WebSearch: use curl or Context7 for library docs
- AskUserQuestion/Question: ask the user in chat
- Task/Subagent/Parallel: run sequentially in main thread; use multi_tool_use.parallel for tool calls
- TodoWrite/TodoRead: use file-based todos in todos/ with file-todos skill
- Skill: open the referenced SKILL.md and follow it
- ExitPlanMode: ignore
<!-- END COMPOUND CODEX TOOL MAP -->

## Desktop Shell Documentation Map

Use `docs/desktop-shell/README.md` as the entrypoint for `apps/desktop-shell` knowledge.

Document categories:

- `architecture/`: current product structure and boundaries
- `decisions/`: durable technical choices and rationale
- `specs/`: approved designs before implementation
- `plans/`: implementation sequencing
- `tokens/`: shared design and functional vocabulary
- `operations/`: maintenance and verification workflows

Update rules:

- If structure changes, update `architecture/`.
- If a durable technical choice changes, add or update `decisions/`.
- If shared vocabulary changes, update `tokens/`.
- If maintenance workflow changes, update `operations/`.
- Keep `AGENTS.md` short; do not duplicate product knowledge here.

在解决 Bug 的时候，如果你不清楚 Bug 的原因，不要猜测，可以添加日志用于精准定位问题。
