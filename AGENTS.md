# AI AGENT RULES AND GUIDELINES

## 1. CORE DIRECTIVE: STRICT SCOPE CONTROL
- **Do ONLY what is explicitly requested.** 
- Do NOT refactor, reformat, or "improve" code outside the requested scope.
- Do NOT add unrequested features, libraries, abstractions, or boilerplate.
- Do NOT delete existing comments, logs, or functions unless asked.
- If you see potential issues in other parts of the code, mention them in your summary instead of modifying them autonomously.

## 2. ENVIRONMENT & OS
- Operating System: **Windows**.
- Terminal: **PowerShell**. Always format terminal commands for PowerShell (e.g., use `Set-ExecutionPolicy`, correct syntax for environment variables, path escaping).
- File Paths: Always use relative paths relative to the project root. Never hardcode absolute Windows paths (like `C:\Users\...`).

## 3. CODE STYLE & QUALITY
- **No unnecessary inline comments.** Write self-documenting code. Add comments ONLY if the logic is complex or explicitly requested.
- Focus on performance, reliability, and robust error handling (`try/catch`).
- Keep function scope tight and modular.

## 4. RESPONSE & COMMUNICATION FORMAT
- Perform all code generation and internal reasoning in **English** (for token efficiency).
- Provide explanations, summaries of changes, and instructions to the user in **Ukrainian**.

## 5. EXECUTION PROTOCOL
1. **Analyze:** Read the task and target files thoroughly before making changes.
2. **Execute:** Make minimal, accurate edits focused solely on the prompt goal.
3. **Verify:** Check syntax, test execution (if tests/scripts exist), and ensure no syntax errors were introduced.