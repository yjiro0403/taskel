# Development Rules & Verification Standards

## core Principle
**"Verify before you ask."**
Never ask the user to test a fix unless you have verified it yourself or explicitly explained why you cannot (e.g., environment limitations) and provided the logic for why it *should* work.

## Verification Checklist
Before marking a task as "Done" or asking the user to check:

1.  **Code Review**: Re-read the modified code in context. Does it handle edge cases? (e.g., empty strings, nulls).
2.  **Logic Tracing**: mentally trace the execution flow.
    -   Input -> Handler -> Store -> State Update -> UI Rendering.
3.  **Logging**: Add temporary `console.log` to critical paths to confirm execution if helpful, then remove or comment them out, or ask the user to share the output if applicable.
4.  **Reproduction**: If possible, write a small test script or unit test to reproduce the issue and verify the fix.

## Specific Scenarios
-   **Form Submission**: Ensure validation logic allows submission. Ensure payload matches database schema.
-   **UI Rendering**: Ensure filters match the data being saved.
