# AI AGENT RULES

## Scope
- Do only what is requested. No refactors, reformatting, new features, libraries or abstractions outside the task.
- Don't delete existing code, comments or logs unless asked. Report unrelated issues in the summary instead of fixing them.
- Bug fix = root cause: grep all callers and fix the shared function once, not each symptom.
- Before writing code: check the codebase, stdlib and installed dependencies for an existing solution.
- If a request is ambiguous or overbuilt, ask whether a simpler option covers it.

## Environment
- Windows + PowerShell: give terminal commands in PowerShell syntax.
- Use project-relative paths in repo code.

## Code
- Don't add new comments unless the logic is non-obvious or a comment is requested. Leave existing ones alone.
- Error handling at trust boundaries (input, I/O, network) and wherever failure could lose data; no blanket try/catch.

## Language
- Code, comments, commits: English.
- Explanations and summaries to the user: Ukrainian.

## Workflow
1. Read the task and the files it touches; trace the real flow before editing.
2. Make the minimal edit that fixes the cause.
3. Run existing tests/linter. For non-trivial new logic leave one minimal runnable check (assert or a single test file).