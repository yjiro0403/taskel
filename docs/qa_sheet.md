# QA Test Sheet - Integration & System Testing

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
