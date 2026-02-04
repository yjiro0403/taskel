# Verification Protocol

**OBJECTIVE:** Ensure 0-defect delivery to the user by verifying all changes before reporting completion.

## 1. Pre-Report Checklist
Before saying "It is done" or "Please check", I must perform the following:

- **Build Check:** Does the code build? (Run `npm run build` or inspect for syntax errors).
- **Runtime Check:** Have I executed the code?
    - If UI logic: Can I simulate the user flow?
    - If API logic: Have I verified the endpoint exists and works?
    - **CRITICAL:** If I modified an API route or Store method, I MUST verify the connection.
    - **Firestore Sanitization:** Have I ensured no `undefined` values are being sent to Firestore (use `sanitizeData` helper)?
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

## 3. Historical Lessons Learned (Anti-Regression)
*Document past failures here to prevent repeating them:*

- **Inconsistency [2026-01-09]:** Task creation allowed choosing a Section and a Start Time that didn't match (e.g., Section "Night" + Time "11:00"). 
    - **Fix:** Implemented last-set priority and real-time UI warnings.
- **API Error [2026-01-09]:** Attempted to update data via missing `/api/sections` route. 
    - **Fix:** Switched to direct Firestore Client SDK for all store operations to ensure consistency and speed.

## 4. Actionable Verification Steps
- If I change a UI component: render it or review the code logic deeply against requirements.
- If I change an API: `curl` it or write a test script to call it.
- **NEVER** assume code works just because it looks correct.

## 5. Failure Protocol
- If an error is found by the user that I could have caught:
    1. Acknowledge the failure in verification.
    2. Fix the error.
    3. Update the "Historical Lessons" section above to track the new case.
