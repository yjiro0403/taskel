# Fixes and Features Log - January 2026

## [2026-01-12] Routine Configuration Enhancement
- **Issue:** Routine tasks were missing context fields like project alignment, tags, and descriptive memos.
- **Change:** 
    - Updated `Routine` and `Task` types in `src/types/index.ts` to include `projectId`, `tags`, and `memo`.
    - Enhanced `RoutineModal.tsx` to include UI for selecting a project, adding tags, and writing memos.
    - Updated `useStore.ts` to ensure these fields are correctly propagated to generated tasks.
- **Impact:** Users can now categorize and document routines more effectively, with metadata carrying over to daily tasks.

## [2026-01-12] Task Inconsistency & Date Filtering Fix
- **Issue:** Tasks were appearing or disappearing inconsistently, particularly in production, due to imprecise date filtering logic.
- **Change:** Refactored date comparison and filtering in `useStore.ts` and `TaskList.tsx` to handle timezone-aware date strings more robustly.
- **Impact:** Reliable task display across different environments and dates.

## [2026-01-10] Firestore Permissions Resolution
- **Issue:** "Missing or insufficient permissions" error when creating projects or updating tasks.
- **Change:** Defined and deployed comprehensive `firestore.rules` to enforce RBAC (Role-Based Access Control) and owner-only edits.
- **Impact:** Secured data while allowing legitimate user operations.

## [2026-01-10] Onboarding Flow & UI Flicker Fix
- **Issue:** UI flickered due to initial mock data, and onboarding tasks reappeared unexpectedly.
- **Change:**
    - Implementation of BFF (Backend-for-Frontend) pattern via `/api/onboarding` for reliable first-time setup.
    - Switched to `localStorage` for tracking onboarding status.
    - Removed default mock data from the store state.
- **Impact:** Clean startup experience and stable onboarding state.
