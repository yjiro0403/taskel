# Image Upload Foundation

This document describes the foundation created for handling task image attachments.

## 1. Firebase Storage Configuration
- **Location**: `src/lib/firebase.ts`
- **Change**: Initialized `storage` service using `getStorage`.
- **Usage**: Import `{ storage }` from `@/lib/firebase`.

## 2. Data Model
- **Location**: `src/types/index.ts`
- **Task Interface**: Added `attachments?: Attachment[]`.
- **Attachment Interface**:
  ```typescript
  export interface Attachment {
      id: string; // Internal ID (UUID)
      url: string; // Download URL
      path: string; // Storage path (users/{uid}/attachments/...)
      name: string; // Original filename
      type: 'image' | 'file';
      size?: number; // Size in bytes
      createdAt: number;
  }
  ```

## 3. Utility Functions
- **Location**: `src/lib/storage.ts`
- **Key Functions**:
  - `compressImage(file: File): Promise<Blob>`
    - Resizes images to max 1200x1200px.
    - Converts to WebP format (quality 0.8).
    - Uses client-side `<canvas>` (no external heavy dependencies).
  - `uploadTaskAttachment(file: File, userId: string): Promise<Attachment>`
    - Validates file size (Max 5MB).
    - Compresses images automatically.
    - Uploads to `users/{userId}/attachments/{uuid}_{filename}`.
    - Sets `Cache-Control: public, max-age=31536000` (1 year) to save bandwidth.
  - `deleteAttachment(path: string): Promise<void>`
    - Deletes file from storage.

## 4. Next Steps (UI Implementation)
To fully implement the feature, you need to:
1.  **Update `AddTaskModal.tsx`**:
    - Add a file input `<input type="file" multiple accept="image/*" />`.
    - Use `uploadTaskAttachment` when files are selected (or on save).
    - Store the returned `Attachment` objects in the `Task` payload.
2.  **Update `TaskItem.tsx` / `TaskDetailModal.tsx`**:
    - Display the attachments (thumbnails).
    - Implement a lightbox or link to open the full image.

## 5. Security Rules (Manual Step)
Ensure your `storage.rules` in Firebase Console allow authenticated users to read/write their own files:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
