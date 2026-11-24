# Universal Engineering and Git Workflow

These are standing instructions for coding agents across projects. Reference for commit style: https://github.com/n8n-io/n8n (conventions only, not a dependency). Apply repository-specific instructions and actual repository policies where more specific; never treat this file as permission to bypass platform restrictions or access a repository that the user has not authorized. Explicit task instructions such as review-only, no commits, or no push take precedence.

## 1. Default operating policy

- Implement authorized tasks end-to-end, including relevant tests and documentation. Do not stop at a plan unless planning is the requested deliverable.
- For repositories the user owns or explicitly authorizes for automated delivery: automatically commit coherent changes, push the task branch, open/update a pull request, and merge the completed PR once all merge gates pass. This is standing workflow authorization, not authorization to publish new repositories, change visibility, bypass checks, or deploy independently.
- For unknown, shared, upstream, forked, or third-party repositories, follow documented contribution rules; do not assume remote write or merge permission from local access. If remote authorization is unclear, keep work local and report what is needed.
- For read-only, analysis-only, or review tasks, do not modify files, commit, push, or merge.
- Never invent progress, test results, authors, issue IDs, PR numbers, or commit history.

## 2. Discover the repository before changes

- Read applicable AGENTS.md files, README, CONTRIBUTING, project plans, build manifests, lockfiles, CI configuration, and existing conventions as relevant.
- Inspect `git status --short --branch`, `git branch --show-current`, `git remote -v`, and `git log -n 10 --oneline`. Identify pre-existing modifications and untracked files; never absorb unrelated user work.
- Identify the intended writable remote, its default/integration branch, the current worktree, upstream tracking, branch protection/rulesets, and permitted merge strategies. For GitHub, use authenticated `gh` metadata or equivalent integration where available; `git remote show <remote>` and the remote HEAD are useful for discovering the default branch. Do not assume `origin`, `main`, or a particular feature branch. Respect documented integration targets instead of guessing.
- Fetch the authorized remote before starting remote-bound work. Check ahead/behind and ancestry. Do not assume local default branch matches the remote default branch.
- If no Git repository, remote, authentication, or default branch exists, do not create a public repository or set a remote on your own. For authorized new local projects, initialize Git if appropriate and report the remaining remote setup.
- Detect the actual stack and package manager; use existing scripts, tooling, and pinned versions. Never assume pnpm, Docker, PostgreSQL, or a framework is universal.

## 3. Branches and isolation

- Use a short-lived branch per coherent task or feature, based on the current authorized integration branch. Suggested names: `feat/<topic>`, `fix/<topic>`, `refactor/<topic>`, `docs/<topic>`, `chore/<topic>`.
- Reuse an existing branch only when it is clearly assigned to the same task and its history is understood. Never reuse a permanent feature branch across unrelated tasks by default.
- Do not work directly on a protected/stable branch for routine development. If a task branch already exists, respect it and avoid unnecessary switching.
- Preserve other agents' and the user's work. Do not stash, reset, clean, overwrite, switch away from, or commit unrelated changes without permission. Use an isolated worktree when appropriate and safe; otherwise report conflicts that prevent isolation.
- Never rewrite published history or force-push. If an updated base is required, use the repository-approved non-destructive synchronization method (e.g. merge the latest base into the task branch if allowed), rerun validation, and push normally. If rules require a rewrite or conflict resolution beyond task scope, stop the affected operation and report.

## 4. Implementation discipline

- Follow existing architecture and style. Prefer small, maintainable changes; avoid unrelated refactors and speculative infrastructure.
- Make a short plan for multi-step work and execute it. Break large work into independently understandable units with working code and relevant tests.
- Protect secrets, personal data, production systems, and existing behavior. Validate inputs, enforce authorization, handle failures and edge cases, and use precise financial arithmetic when relevant.
- Use isolated test environments and non-production data. Never run destructive migrations, production jobs, external transactions, or independent deployments without specific authorization.
- Keep documentation accurate; avoid duplicate instructions, stale status notes, fake examples presented as facts, and claims about functionality not implemented.

## 5. Commit workflow (mandatory for authorized implementation)

After each meaningful, coherent unit, rather than only at the end:

1. Inspect status and relevant diffs. Review staged and unstaged changes for scope, correctness, secrets, and unrelated files.
2. Run relevant formatting, lint, type checks, tests, and other checks defined by this repository. Run broader checks at milestones and before merge. Fix regressions before committing.
3. Stage only the specific files or hunks belonging to the unit. Avoid blanket staging when unrelated files exist.
4. Inspect `git diff --cached`, `git diff --cached --check`, and the staged file list.
5. Create a real commit and verify its hash and message. Do not bypass hooks, create empty/artificial commits, or falsify timestamps.
6. Continue implementing the next unit. A blocked remote push does not prevent safe local implementation and validation unless the task depends on remote state.

Use the repository's established commit conventions. Where none exist, use n8n-inspired Conventional Commits with English, imperative, capitalized subjects:

`type(scope): Capitalized imperative summary`

Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `style`, `build`, `ci`, `chore`, `revert`. Scope is meaningful when applicable; prefer subject length <= 72 characters. Explain why in the body when helpful. Follow existing breaking-change conventions. Add attribution trailers only for actual contributors or when required by the repository; never impersonate another coding agent.

Examples:

- `feat(auth): Add session management`
- `fix(api): Prevent duplicate submissions`
- `refactor(core): Centralize validation rules`
- `test(database): Cover transaction rollback`
- `docs: Document local setup`
- `ci: Add automated quality checks`

Do not use vague subjects such as `update`, `done`, `fix stuff`, or `final`. Do not chase a target commit count. Each commit should have a coherent purpose.

## 6. Automatic push to the task branch

- For an authorized writable repository, push each validated coherent commit or related batch promptly to its task branch. Do not push the stable branch directly in the default workflow.
- First push: `git push -u <remote> <task-branch>`; subsequent pushes use the confirmed upstream or explicit remote/branch. These are placeholders, not literal shell arguments.
- Confirm the push succeeded and verify the remote branch when possible. Do not equate a local commit with a successful push.
- If authentication, network, non-fast-forward, or permissions block the push, do not bypass restrictions or overwrite remote changes. Preserve local commits, report the blocker, and resume remote delivery only after it is resolved.
- Never commit or push secrets, credentials, sensitive data, local caches, or generated artifacts unless intentionally tracked and appropriate.

## 7. Pull requests and merge gates

- Use one PR per coherent deliverable, not one PR per commit. Open or update the existing PR from the task branch to the discovered integration branch. A draft PR is appropriate while implementation is incomplete; make it ready only when the feature is complete.
- Use authenticated GitHub CLI (`gh pr create`, `gh pr view`, `gh pr checks`, `gh pr merge`) or equivalent authorized tooling. Respect PR templates. Do not create duplicate PRs or misidentify the base/head repositories.
- Use a descriptive PR title consistent with repository conventions. Include summary, rationale, actual tests, migrations or compatibility impact, risks, limitations, and relevant screenshots for UI changes when available.
- Before merge, ensure all intended commits are pushed, the PR contains only intended changes, the feature is complete, and the relevant local validation (including build/integration/E2E where applicable) succeeded. Review the full PR diff for bugs, security, compatibility, and accidentally included files.
- Inspect GitHub mergeability, required checks, approval state, unresolved blocking reviews, and required merge queue. Confirm checks correspond to the current PR head and required integration state. Never assume a check passed because its workflow is absent, billing is blocked, or a command returned no data.
- Wait for required CI and reviews within the available execution window. If pending, report the pending state or use repository-supported auto-merge when authorized and all necessary checks/reviews are configured. Never promise background work. A failed/cancelled/missing expected check or unresolved conflict blocks merge until resolved; fix and rerun checks where possible.
- If CI is not configured at all, do not assume local checks are an automatic substitute. Merge automatically only when an explicit repository-specific policy permits local-only validation and all required local checks have passed. Do not create an exception merely because CI is currently unavailable.
- Merge automatically after all gates pass if the repository is authorized for automated delivery. Do not repeatedly request confirmation for routine authorized actions. Respect any required human approval; never self-approve, impersonate reviewers, dismiss blocking reviews, use admin bypass, or weaken rulesets to complete a merge.
- Use the repository's permitted merge strategy. Prefer a standard merge commit where preserving individual incremental commit hashes on the default branch matters and policy allows it. If linear history is required, use an approved rebase merge when permitted (commit hashes may change) or squash merge if that is the repository's convention (individual commits remain in the PR, not in default-branch history). Never invent a merge strategy or override repository restrictions.
- Verify the PR is actually merged and identify the resulting base commit. An auto-merge request or queued merge is not a completed merge. Refresh local remote references after success, and fast-forward the local base only if its working tree is safe and it has no unrelated local commits. Do not delete branches automatically unless existing policy or explicit permission allows it.
- Start unrelated subsequent tasks from the updated integration branch, not a stale feature branch.

## 8. Exceptional direct fast-forward workflow

Only when an explicit repository-specific instruction opts into direct fast-forward integration (e.g. a private solo repository), and repository rules permit it, may the agent merge the completed task branch into the integration branch locally and push it. Do not use it as a fallback for failed PR creation or blocked CI.

Before doing so: verify the remote, exact integration branch, clean/isolation-safe worktree, ownership, branch ancestry, complete task scope, actual local checks, required remote checks/reviews, and any production auto-deploy implications. Fetch again; verify the local integration branch has no unrelated local-only commits and can fast-forward to its remote tip. Only use `git merge --ff-only` for the authorized task and a normal non-forced push. If any step fails or the remote advances incompatibly, stop and report. Do not bypass branch protections. Merge completed deliverables, not every partial commit, unless the repository explicitly requires each commit to be independently production-ready and authorizes that behavior.

## 9. Quality and security gates

- Discover and run the repository's documented checks with its own tooling. Do not introduce a different stack just for validation.
- Record which commands passed, failed, or could not run. Do not claim unexecuted checks passed. Required unavailable checks block automatic merge unless explicitly covered by a pre-existing policy; report the exact blocker.
- Never disable tests, hooks, CI, security checks, branch protections, or required reviews to get a green status. Do not change CI permissions or repository settings without explicit approval.
- Routine pushes/merges may trigger preconfigured CI and deployments. If integration would trigger a production deployment or other high-impact external action, confirm the repository has explicit standing authorization for that consequence; otherwise leave the PR ready and report the pending approval. Do not independently deploy, publish packages, create releases/tags, or alter production data without explicit permission.
- Do not use `git push --force` (including force-with-lease), destructive resets, `git clean` on user work, history rewrites, or remote branch deletion without explicit approval and applicable policy.

## 10. Completion report

At the end of an implementation task, report:

- What changed and any remaining limitations.
- Actual validation commands and outcomes (passed / failed / not run, with reasons).
- Branch, actual commit hashes and subjects, push status and destination.
- PR URL and state (draft/open/queued/merged/blocked), checks/reviews status, and merge commit or resulting base revision when applicable.
- Final working tree status and unrelated user changes preserved.
- Any action requiring user intervention. Distinguish local completion from remote integration and production deployment.

A task is fully delivered only when its intended scope and checks are complete and the configured authorized delivery workflow has actually succeeded. If remote work is blocked, preserve the work and report it honestly. Do not create fake commits or perform unsafe actions to satisfy a definition of done.
