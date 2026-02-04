---
name: Development Skill
description: Core coding standards, design guidelines, and architecture rules for Taskel/T-Chute.
---

# Development Skill

This skill enforces the coding standards, design principles, and architectural rules for the Taskel/T-Chute application.

## 1. Core Principles

**"Verify before you ask."**
Never ask the user to test a fix unless you have verified it yourself.
- **Code Review**: Re-read modified code in context. Handle edge cases.
- **Logic Tracing**: Mentally trace execution: Input -> Handler -> Store -> State Update -> UI.
- **Reproduction**: Write test scripts or unit tests to reproduce issues.

## 2. Design Guidelines

### Accessibility & Visibility
- **High Contrast**: NO low-contrast gray-on-gray. Use `text-gray-900` or `black` on light backgrounds.
- **Secondary Text**: Use `text-gray-500` or darker.
- **Backgrounds**: `bg-white` for content, `bg-gray-50` for sidebars.

### Forms & Inputs
- **Visibility**: Inputs must be distinguishable (`bg-white` or `bg-gray-50` with border).
- **Text Color**: Input text must be `text-gray-900`.
- **Focus**: All interactive elements need a visible focus state.

### Interactive Elements
- **Buttons**: Must have hover/active states.
- **Cursor**: `cursor-pointer` for all clickable elements.

### Mobile & Responsive
- **Touch Targets**: Minimum 44px.

## 3. Architecture & Data

### Firestore Write Operations (BFF Pattern)
- **CRITICAL**: Critical Firestore write operations (create task, update status) **MUST** be routed through a BFF API route (`/api/...`).
- **Reason**: Direct calls to `firestore.googleapis.com` are often blocked by ad-blockers.
- **Implementation**:
    - Use `fetch('/api/tasks', ...)` for writes.
    - Keep optimistic UI updates in the client store.
    - Do NOT use direct `setDoc`/`updateDoc` in the client for critical user data.

## 4. Specific Scenarios
- **Form Submission**: Ensure validation logic allows submission and payload matches DB schema.
- **UI Rendering**: Ensure filters match the data being saved.

## 5. Communication & Error Handling

### "Don't Assume, Verify"
- **No Optimistic Silence**: If a command fails or a file looks suspicious, DO NOT silently attempt to fix it and move on without verifying the root cause.
- **Reporting**: Report "Unexpected Errors" or "Blocked States" immediately to the user.
- **Partial Success is Failure**: If a script runs but outputs warnings or errors you didn't expect, treat it as a failure until proven otherwise.

### Handling File Corruption & Conflicts
- **Whole File Check**: If you encounter a syntax error or a git conflict (e.g., `>>>>>>>`), you MUST check the **entire file** for consistency, not just the reported line.
- **Markers**: Actively search for `<<<<<<<`, `=======`, `>>>>>>>` in the file content before declaring a merge resolution complete.
