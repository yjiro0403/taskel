---
name: Documentation Skill
description: Mandatory workflow for maintaining documentation and specification files.
---

# Documentation Skill

This skill outlines the MANDATORY workflow for all implementation tasks to ensure long-term maintainability and quality assurance.

## 1. Specification Documentation (`_spec.md`)

Whenever a new feature is designed or a significant logic change (like a refactor) occurs, you MUST create or update a dedicated specification document in the `docs/` folder.

- **Naming Convention**: `docs/feature_name_spec.md` (e.g., `docs/routine_virtual_projection_spec.md`).
- **Content Requirements**:
    1.  **Overview**: What is being solved?
    2.  **Architecture/Logic**: How does it work? (Flowcharts, steps, algorithms).
    3.  **Data Structure**: Changes to `types/index.ts` or DB schema.
    4.  **Key Decisions**: Why was this approach chosen? (Trade-offs).

## 2. QA Sheet Updates (`qa_sheet.md`)

You must NOT rely solely on "it works for me". You must verify it against a structured test plan.

- **Action**: Add new rows to `docs/qa_sheet.md`.
- **Format**:
    - **Test ID**: Unique identifier (e.g., `VIRT-01`).
    - **Category**: Feature area.
    - **Steps**: Clear, reproducible steps.
    - **Expected Result**: unambiguous success criteria.

## 3. Workflow Trigger

This documentation process is not an afterthought. It should be performed **BEFORE** or **CONCURRENTLY** with the final commit/push of the code.

> **Agent Rule**: Do not ask the user "Should I document this?". **ALWAYS** do it as part of the "Definition of Done".
