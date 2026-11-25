# Contributing

Read `global/AGENTS.md`, `project/AGENTS.md`, and the LPStacks specification in `project/plan.md`. Keep financial rules in domain services, do not fetch or log sensitive data in client components, and test against isolated PostgreSQL databases. Use the commands and prerequisites in [README.md](README.md).

Commit validated work in coherent units (`type(scope): Capitalized imperative summary`). Open a task-branch pull request with its validation results and any migration or accounting compatibility changes. Follow [LPStacks' validation policy](project/AGENTS.md#verification-and-delivery): GitHub Actions is advisory unless GitHub requires it, and applicable local checks still need to pass. Do not bypass GitHub requirements or deploy as part of routine Git delivery.
