# Acceptance Test Rules & Standards

**OBJECTIVE:** To ensure that every feature delivery is robust, consistent, and meets user expectations.

## 1. Feature-Specific Acceptance Criteria
Every new feature request must include a set of specific test items in a dedicated "Acceptance Items" section of the task documentation or a `docs/` file. 

### Mandatory Checklist for Developers:
- [ ] **Functional Verification:** Does the feature solve the specific problem described?
- [ ] **UI/UX Consistency:** Does the design match the established aesthetic and responsiveness of the app?
- [ ] **Data Integrity:** Are all new fields sanitized? Are there logical contradictions in the saved data?
- [ ] **Role-Based Access:** If applicable, are Firestore rules updated and tested?

## 2. Standard Quality Gates
Before any feature is reported as "Done", it MUST pass these checks:

### A. Technical Gates
- **Build Success:** `npm run build` passes without errors.
- **Linting:** No critical ESLint warnings or errors in the modified files.
- **Sanitization:** Use `sanitizeData` helper for all Firestore writes.

### B. Functional Gates
- **Crucial Flow:** The primary user path for the feature works from start to finish.
- **Edge Cases:** What happens with empty inputs, long strings, or rapid clicking?
- **Persistence:** Does the change persist after a page refresh?

## 3. Anti-Regression & History Check
- Review `rules/verification_protocol.md` for common pitfalls.
- Review recent entries in `docs/fixes_and_features_*.md` to ensure no regression on previously fixed bugs (e.g., Routine-to-Task metadata propagation).

## 4. Documentation Rule
When completing a significant change:
1. Update `docs/fixes_and_features_YYYY_MM.md`.
2. Update/Add items to `docs/qa_sheet.md` if the change introduces new complexity or risk.
