---
name: Verification Skill
description: Standardized QA and verification process for ensuring 0-defect delivery.
---

# Verification Skill

This skill outlines the mandatory verification steps and quality checks that must be performed before reporting any task as complete.

## 1. Pre-Report Checklist (Verification Protocol)

Before saying "It is done" or "Please check", you MUST perform the following:

- **Build Check:** Does the code build? (Run `npm run build` or inspect for syntax errors).
- **Integrity Check:**
    - If git operations occurred, search for conflict markers (`<<<<<<<`, `>>>>>>>`) in ALL modified files.
    - Verify file ends and mismatched braces if large edits were made.
- **Runtime Check:** Have you executed the code?
    - If UI logic: Can you simulate the user flow?
    - If API logic: Have you verified the endpoint exists and works?
    - **CRITICAL:** If you modified an API route or Store method, you MUST verify the connection.
    - **Firestore Sanitization:** Have you ensured no `undefined` values are being sent to Firestore (use `sanitizeData` helper)?
- **Error Check:** Are there any console errors? (500, 404, etc.)

## 2. Data Consistency & QA Check Items

Before every delivery, verify there are no logical contradictions in the data:

- **Section-Time Alignment:** Is the task's `scheduledStart` actually within the boundaries of the assigned `section`? 
- **Time Range Validity:** Is `startTime` < `endTime`? (Prevent negative durations).
- **Status Integrity:** 
    - If `status === 'done'`, is `completedAt` set?
    - If `status === 'in_progress'`, is `startedAt` set?
    - If a task is not active, are `startedAt` and `completedAt` correctly managed?
- **Sequential Integrity:** Are `order` fields correctly assigned to prevent overlapping or missing gaps?

## 3. Acceptance Test Rules

### Mandatory Checklist for Developers:
- [ ] **Functional Verification:** Does the feature solve the specific problem described?
- [ ] **UI/UX Consistency:** Does the design match the established aesthetic and responsiveness of the app?
- [ ] **Data Integrity:** Are all new fields sanitized? Are there logical contradictions in the saved data?
- [ ] **Role-Based Access:** If applicable, are Firestore rules updated and tested?

### Standard Quality Gates
- **Build Success:** `npm run build` passes without errors.
- **Linting:** No critical ESLint warnings or errors in the modified files.
- **Sanitization:** Use `sanitizeData` helper for all Firestore writes.

## 4. QA Test Sheet (Reference)

When verifying features, refer to these standard test cases:

| Test ID | Category | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ROUT-01** | Routines | Add Metadata to Routine | Authenticated | 1. Open Routine Modal.<br>2. Fill Title, Project, Tags, and Memo.<br>3. Save. | Routine is saved with all 4 metadata fields visible on edit. |
| **ROUT-02** | Routines | Propagation to Task | ROUT-01 complete | 1. Trigger routine generation for today.<br>2. Click on the generated task. | Task should have the same Project, Tags, and Memo as the Routine. |
| **TASK-01** | Tasks | Date Consistency | Tasks exist for multiple dates | 1. Create tasks for 2026-01-12 and 2026-01-13.<br>2. Switch between dates in UI. | Only tasks belonging to the selected date are shown. |
| **PERM-01** | Auth | Unauthorized Access | Logged out or different user | 1. Attempt to access a project URL of another user. | Firestore should deny access (Verified via console/UI error handling). |
| **ONBD-01** | Onboarding | First-time Flow | New user or cleared localStorage | 1. Login/Visit landing page. | User Guide/Intro tasks are triggered via `/api/onboarding`. |
| **ONBD-02** | Onboarding | Persistence | ONBD-01 complete | 1. Refresh page or login again. | Intro tasks/User Guide should NOT reappear unnecessarily. |
| **UTIL-01** | Data | Firestore Sanitization | Developer tools open | 1. Create a task with an empty description/optional field. | No `undefined` field errors in console/Firestore. |
| **VIRT-01** | Virtual | Infinite Future Projection | Routine exists | 1. Go to Calendar.<br>2. Move 1 year into the future.<br>3. Select a date. | Virtual tasks from routines appear correctly. |
| **VIRT-02** | Virtual | Instantiation on Action | Virtual task visible | 1. Click "Play" on a virtual task.<br>2. Refresh page. | Task is now a real task in DB and state is persisted (in_progress/done). |
| **VIRT-03** | Virtual | Deduplication | Virtual task visible | 1. Edit a virtual task (title).<br>2. Confirm display. | Only the edited (real) task is shown; the virtual one is hidden by the same ID. |
| **VIRT-04** | Virtual | Routine Deletion Sync | Routine and virtual tasks exist | 1. Delete a Routine. | All associated virtual tasks for all future dates disappear immediately. |
| **TASK-02** | Tasks | Sorting by Scheduled Start | Tasks exist in section | 1. Set Task A time "10:00".<br>2. Set Task B time "09:00". | Task B appears before Task A in the list. |
| **TASK-03** | Mobile/UI | Tag Selection via Enter | Mobile Soft Keyboard | 1. Open Add Task/Routine Modal.<br>2. Type tag.<br>3. Press Enter on keypad. | Tag is added as a chip. Form does NOT submit. Focus remains. |
| **TASK-04** | Tasks | Task Duplication | Task exists | 1. Locate task.<br>2. Click Duplicate (Copy icon left of time). | A new task with "(copy)" suffix is created in the same section with same metadata. |
| **DND-01** | DnD | セクション内並び替え | 同一セクションに2タスク以上 | 1. タスクAをドラッグ<br>2. タスクBの上にドロップ | タスクAがタスクBの上に移動、順序永続化 |
| **DND-02** | DnD | セクション間移動 | 複数セクションにタスク | 1. MorningのタスクをAfternoonにドラッグ | タスクがAfternoonに移動、sectionId更新 |
| **DND-10** | DnD | スケジュールタスク順序固定 | 10:00と11:00のタスクが存在 | 1. 11:00を10:00の上にドラッグ | スナップバック（時間順序優先） |
| **DND-11** | DnD | 未スケジュールとスケジュール混在 | 両タイプのタスクが存在 | 1. 未スケジュールをスケジュール間にドラッグ | 移動可能（order優先） |
| **DND-30** | DnD | APIエラー時ロールバック | APIを500エラーに設定 | 1. タスクをドラッグ・ドロップ | エラー後にUIロールバック |
| **DND-71** | DnD | 永続化確認 | DnD操作実行後 | 1. ページリロード | 操作後の順序が維持 |

## 5. Failure Protocol
- If an error is found by the user that you could have caught:
    2. Fix the error.
    3. Determine prevention for the future.

## 6. Post-Merge/Conflict Protocol
If you have resolved a git conflict or performed a complex merge/rebase:
1.  **Search globally** for `<<<<<<<`, `=======`, `>>>>>>>` to ensure no markers were missed.
2.  **Verify syntax** of the *entire* file, specifically focusing on:
    - Closing braces `}` for functions/classes (often lost in merges).
    - Import statements (often duplicated).
3.  **Clean Build**: Run a fresh build/type-check (`npm run build` or `tsc --noEmit`) to catch structural errors that incremental builds might miss.

