# Design Guidelines

This document outlines the design principles and guidelines for the Taskel/T-Chute application. All future development should adhere to these rules to ensure a consistent, accessible, and user-friendly experience.

## 1. Accessibility & Visibility

### **High Contrast is Mandatory**
*   **DO NOT** use gray text on a gray background or any low-contrast combination.
*   Backgrounds and text must have sufficient contrast to be readable by all users.
*   **Primary Text**: Use `text-gray-900` or `black` on white/light gray backgrounds.
*   **Secondary Text**: Use `text-gray-500` or darker. Avoid `text-gray-400` for essential text on light backgrounds.

### **Color Palette Usage**
*   **Backgrounds**:
    *   Main Content: `bg-white`
    *   Sidebar/Secondary: `bg-gray-50`
*   **Text**:
    *   Headings/Body: `text-gray-900`
    *   Subtitles: `text-gray-600`
    *   Placeholders: `placeholder:text-gray-400` (ensure input background differs from container if needed)

## 2. Forms & Inputs

### **Input Fields**
*   Text inputs must be clearly distinguishable from the background.
*   Use `bg-white` or `bg-gray-50` with a border (`border-gray-200` or `border-gray-300`).
*   **Text Color**: Input text must be dark (`text-gray-900`) to be readable.
*   **Focus State**: All interactive elements must have a visible focus state (e.g., `focus:ring-2`, `focus:border-blue-500`).

## 3. Feedback & Interactivity

### **Interactive Elements**
*   **Buttons**: Must have hover and active states.
*   **Disabled State**: Visually distinct but still legible.
*   **Cursor**: Use `cursor-pointer` for all clickable elements.

## 4. Specific Component Rules

### **Filters & Search Bars**
*   When placing filters on a gray background (`bg-gray-50`), the input field itself should be `bg-white` or have high-contrast text.
*   **Rule**: Identify gray-on-gray issues immediately during development and fix them.

## 5. Mobile & Responsive
*   Ensure touch targets are large enough (min 44px recommended).

## 6. Architecture & Data
### **Firestore Write Operations**
*   **Critical Rule**: Critical Firestore write operations (e.g., creating tasks, updating status) **MUST** be routed through a BFF (Backend For Frontend) API route (`/api/...`).
*   **Reason**: Direct client-side calls to `firestore.googleapis.com` are frequently blocked by ad-blockers and privacy extensions (`net::ERR_BLOCKED_BY_CLIENT`), leading to data loss.
*   **Implementation**: Use `fetch('/api/tasks', ...)` for writes, while keeping optimistic UI updates in the client store. Refrain from direct `setDoc/updateDoc` in the client for critical user data.
