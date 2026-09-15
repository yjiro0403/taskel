# QA Test Sheet - Comprehensive (2026-01-21)

This list covers all implemented features found in the codebase as of Jan 21, 2026.

## 1. Authentication & Onboarding
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **AUTH-01** | Login | Login with Google | Logged out | 1. Click "Log in".<br>2. Complete Google Auth. | Redirected to Dashboard. User data loaded. |
| **AUTH-02** | Logout | Logout | Logged in | 1. Open User Menu.<br>2. Click Logout. | Redirected to Landing Page. Storage cleared. |
| **AUTH-03** | Account Deletion | Delete Account | Logged in | 1. Open Sidebar.<br>2. Click Delete Account.<br>3. Confirm. | Account and all data deleted. Redirected to Landing Page. |
| **ONBD-01** | First Access | Onboarding Tour | New User | 1. Login for first time. | "User Guide" or intro tasks appear. |
| **ONBD-02** | Return User | Persistence of State | ONBD-01 Done | 1. Reload page. | Onboarding does not reappear. |

## 2. Task Management (Core)
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-01** | Create | Add Task (Quick) | Dashboard Open | 1. Type title in input.<br>2. Press Enter. | Task appears in current section. Status: Open. |
| **TASK-02** | Create | Add Task (Modal) | Dashboard Open | 1. Click "+" button.<br>2. Fill Title, Est Time, Project, Tags. | Task created with all metadata. |
| **TASK-03** | Edit | Edit Task Details | Task exists | 1. Click Task.<br>2. Edit Title/Memo.<br>3. Save. | Updates reflected immediately. |
| **TASK-04** | Status | Complete Task | Task Open | 1. Click Checkbox. | Task moves to "Done" state (visual style change). |
| **TASK-05** | Status | Reopen Task | Task Done | 1. Uncheck box. | Task returns to "Open" state. |
| **TASK-06** | Delete | Delete Task | Task exists | 1. Click Delete icon. | Task removed from list and DB. |
| **TASK-07** | Duplicate | Duplicate Task | Task exists | 1. Click Duplicate icon. | Copy created with "(copy)" suffix in same section. |
| **TASK-08** | Move | Change Date/Section | Task exists | 1. Edit task.<br>2. Change Date. | Task disappears from current view, appears on new date. |
| **TASK-09** | Import | Google Calendar Sync | GCal Connected | 1. Click Sync. | Events imported as tasks. Time/Date match. |

## 3. Project Management
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PROJ-01** | Create | Create Project | Logged in | 1. Go to Projects.<br>2. Click "New Project".<br>3. Enter Name. | Project created. User is Owner. |
| **PROJ-02** | View | Project List | Projects exist | 1. Open Project List. | All user's projects listed. |
| **PROJ-03** | View | Project Details | Project exists | 1. Click Project. | Task list filtered by this project shown. |
| **PROJ-04** | Edit | Edit Project Name | Owner | 1. Open Settings.<br>2. Rename.<br>3. Save. | Name updated globally. |
| **PROJ-05** | Members | Invite by Email | Owner | 1. Enter email.<br>2. Send Invite. | User receives invite (or mock success). |
| **PROJ-06** | Members | Generate Link | Owner | 1. Click "Generate Link". | Shareable URL copied to clipboard. |
| **PROJ-07** | Access | View Shared Project | Member | 1. Access Project. | Can view/edit tasks based on role. |
| **PROJ-08** | Delete | Delete Project | Owner | 1. Click Delete. | Project removed. Tasks handled (deleted/orphaned). |

## 4. Routine Management
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ROUT-01** | Create | Create Routine | Logged in | 1. Go to Routines.<br>2. Click New.<br>3. Set Freq (Daily/Weekly). | Routine appears in list. |
| **ROUT-02** | Projection | Future Virtual Tasks | Routine exists | 1. Go to Calendar (next week). | Routine appears as "Virtual Task". |
| **ROUT-03** | Instantiation | Edit Virtual Task | Virtual Task visible | 1. Edit Virtual Task (e.g. change time). | Becomes Real Task. Changes persist. |
| **ROUT-04** | Metadata | Routine Context | - | 1. Add Project/Tags to Routine. | Generated tasks inherit Project/Tags. |
| **ROUT-05** | Delete | Delete Routine | Routine exists | 1. Delete Routine. | Future virtual tasks disappear. Real tasks remain. |

## 5. UI/UX & Views
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **VIEW-01** | Planning | Date Navigation | - | 1. Click Next Day/Prev Day. | Task list updates to selected date. |
| **VIEW-02** | Analytics | View Charts | Data exists | 1. Go to Analytics. | Charts show correct task counts/times. |
| **VIEW-03** | Sidebar | Toggle Sidebar | - | 1. Click Menu icon. | Sidebar slides in/out. |
| **VIEW-04** | Settings | Section Settings | - | 1. Change Section Name (e.g., "Morning"). | Main list headers update. |
| **VIEW-05** | Product | Switch Product | Multiple products | 1. Use Product Switcher. | Context switches (if implemented). |
| **VIEW-06** | Views | Weekly/Monthly/Yearly | - | 1. Switch Tabs (Weekly, Monthly, Yearly). | Correct view renders with goals and tasks. |

## 6. Security (Firestore Rules)
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Data Isolation | Access Other's Data | User A & B | 1. User A tries to read User B's tasks. | Access Denied (Firestore Error). |
| **SEC-02** | Project | Write Access | Member | 1. Member tries to edit Project Settings. | Success/Fail depends on Role ( Owner only?). |

## 7. Legal & Compliance
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **LGL-01** | Links | Privacy Policy | Sidebar | 1. Click Privacy Policy. | Opens correct page. |
| **LGL-02** | Links | Terms of Service | Sidebar | 1. Click Terms. | Opens correct page. |

## 8. Time Tracking
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TIME-01** | Timer | Start Timer | Task in list | 1. Click Play icon on task. | Task moves to "Today" (if not there). Status becomes "In Progress". Pulse animation starts. |
| **TIME-02** | Timer | Stop Timer | Timer Running | 1. Click Stop (Square) icon. | Timer stops. Actual time increments. Status returns to "Open". |
| **TIME-03** | Metrics | Auto-Calculation | Task Done | 1. Run timer for X mins.<br>2. Stop. | "Actual Minutes" field aligns with run duration. |

## 9. Goal Management
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GOAL-01** | Monthly | Create Goal | Monthly View | 1. Enter text in "Add a goal...".<br>2. Press Enter/Add. | Goal appears in Monthly Goals list. |
| **GOAL-02** | Monthly | Toggle Goal | Goal exists | 1. Click checkbox on goal. | Goal marked as done. Visual feedback. |
| **GOAL-03** | Edit | Edit Goal | Goal exists | 1. Click goal text.<br>2. Edit in modal.<br>3. Save. | Title/Project updated. |
| **GOAL-04** | Sort | Drag & Drop | Multiple Goals | 1. Drag goal handle.<br>2. Move to new position. | Order updates and persists. |
| **GOAL-05** | Weekly | Weekly Goals | Weekly View | 1. Add goal in Weekly column. | Goal appears for specific week. |
| **GOAL-06** | Yearly | Yearly Goals | Yearly View | 1. Add goal in Yearly column. | Goal appears for specific year. |

## 10. Reflection & Notes
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NOTE-01** | Daily | Create Daily Note | Task List View | 1. Go to "Task List" View.<br>2. Click Document Icon in Date Bar.<br>3. Write Markdown. | Note saves automatically (debounced). Persists on reload. |
| **NOTE-02** | Report | Copy Report | Note exists | 1. Click "Copy Report" in Modal. | Markdown summary (Tasks + Note) copied to clipboard. |
| **NOTE-03** | Period | Monthly Reflection | Monthly View | 1. Type in Right Sidebar (Monthly Notes). | Note saves for that specific month. |
| **NOTE-04** | Period | Weekly Reflection | Weekly View | 1. Type in Right Sidebar (Weekly Notes). | Note saves for that specific week. |
| **NOTE-05** | Period | Yearly Reflection | Yearly View | 1. Type in Right Sidebar (Yearly Notes). | Note saves for that specific year. |

## 11. Advanced Task Management
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ADV-01** | Filter | Filter by Text | Right Sidebar | 1. Open Right Sidebar.<br>2. Type in Search. | Task list (Unscheduled) filters by text matches. |
| **ADV-02** | Filter | Filter by Project | Right Sidebar | 1. Select Project from dropdown. | Only tasks from project shown. |
| **ADV-03** | Filter | Filter by Tags | Right Sidebar | 1. Select Tags (Multi-select). | Only tasks with selected tags shown. |
| **ADV-04** | Bulk | Bulk Select | Multiple Tasks | 1. Click selection circle on multiple tasks. | Selection Header appears at top. Count updates. |
| **ADV-05** | Bulk | Bulk Delete | Tasks Selected | 1. Click Delete in Selection Header.<br>2. Confirm. | All selected tasks deleted. |
| **ADV-06** | Bulk | Bulk Move | Tasks Selected | 1. Select Date in Selection Header.<br>2. Click Move. | All selected tasks moved to new date. |

## 12. Section Management
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SECT-01** | Create | Add New Section | Section Settings | 1. Click "Add New Section". | New section appears in list. |
| **SECT-02** | Edit | Rename Section | Section Settings | 1. Edit Name input.<br>2. Save. | Name updates in Task List headers. |
| **SECT-03** | Edit | Change Start Time | Section Settings | 1. Change Start Time (e.g. 09:00).<br>2. Save. | Schedule recalculates based on new time. |
| **SECT-04** | Delete | Delete Section | Section Settings | 1. Click Delete icon on section.<br>2. Save. | Section removed. Tasks preserved? (Verify behavior). |

## 13. Analytics Features
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ANA-01** | Trend | Switch Metric | Analytics Page | 1. Click "Tasks" toggle. | Trend chart shows count bars. |
| **ANA-02** | Trend | Switch Metric | Analytics Page | 1. Click "Time" toggle. | Trend chart shows hours/minutes bars. |
| **ANA-03** | Period | Weekly/Monthly View | Analytics Page | 1. Switch Time Range (Week/Month). | Charts update to show correct period data. |
| **ANA-04** | Breakdown | Tag Distribution | Tasks with Tags | 1. View "Tasks by Tag" chart. | Bars reflect correct count per tag. |

## 14. Input Validation (Abnormal)
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **VAL-01** | Task | Empty Title | Modal | 1. Open Add Task modal.<br>2. Leave title empty.<br>3. Click Save. | Save button disabled OR error message shown. |
| **VAL-02** | Task | Long Strings | Modal | 1. Enter 500+ char title. | Input accepts or truncates gracefully. UI does not break. |
| **VAL-03** | Date | Invalid Date | Modal | 1. Manually input 'invalid-date'. | Input rejects or defaults to valid date. |
| **VAL-04** | Section | Empty Name | Section Settings | 1. Clear section name.<br>2. Save. | Validation error or restore default. |

## 15. Network & Infrastructure (Abnormal)
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **NET-01** | Sync | Offline Edit | Network OFF | 1. Edit a task.<br>2. Turn Network ON. | Change syncs to Firestore automatically. |
| **NET-02** | Sync | Offline Create | Network OFF | 1. Create a task. | Task appears locally immediately. Syncs later. |
| **NET-03** | Connect | API Failure | Mock 500 Error | 1. Load Task List. | Error boundary or "Retry" message shown (not white screen). |
| **NET-04** | Connect | Latency | Slow Network | 1. Rapidly toggle 'Done'. | UI updates optimistically. Final state matches server. |

## 16. Security Boundaries (Abnormal)
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-03** | Auth | Session Expiry | Token Expired | 1. Try to edit task. | Action fails blocks, redirects to Login, or prompts re-auth. |
| **SEC-04** | Access | Invalid Project ID | URL Manipulation | 1. Navigate to `/projects/invalid-id`. | 404 Page or Redirect to Project List. |
| **SEC-05** | Access | Unauthorized Project | URL Manipulation | 1. Navigate to project ID user is not member of. | Access Denied / Redirect. |

## 17. Concurrency & Race Conditions (Abnormal)
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **RACE-01** | Edit | Simultaneous Edit | 2 Devices/Tabs | 1. Device A opens task.<br>2. Device B opens task.<br>3. Both save different titles. | Last write wins (Firestore default). UI updates to match server. |
| **RACE-02** | Delete | Edit Deleted Task | 2 Devices/Tabs | 1. Device A deletes task.<br>2. Device B tries to edit same task. | Error handled gracefully (e.g. "Task not found"). |
| **RACE-03** | Timer | Double Start | Quick Click | 1. Rapidly click Start Timer. | Only one timer starts. No duplicate records. |

## 18. Money Tracking (Finance)
| ID | Feature | Test Case | Pre-conditions | Steps | Expected Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FIN-01** | Settings | Default off | Logged in, no preference row | 1. Open Settings → General.<br>2. Open a dated task.<br>3. Check daily and planning headers. | Toggle is OFF. No finance editor or header totals. Apart from loading the preference itself, no category, entry, or summary request runs. Existing Taskel behavior is unchanged. |
| **FIN-02** | Settings | Enable | FIN-01 | 1. Turn money tracking ON.<br>2. Reopen a dated task. | Finance rows editor appears. Header totals appear (¥0 if empty). |
| **FIN-03** | Settings | Disable preserves data | Finance rows exist | 1. Turn money tracking OFF.<br>2. Confirm UI is hidden.<br>3. Turn ON again and reopen the task. | Records reappear. Nothing was deleted. |
| **FIN-04** | Task modal | Multiple rows | Feature ON, dated task | 1. Add a 20,000 expense and a 10,000 income.<br>2. Save. | Both rows persist. Modal closes only after task **and** finance save succeed. |
| **FIN-05** | Validation | Amount | Feature ON | 1. Enter `0`, `-1`, `1.5`, `1e3`.<br>2. Save. | Save blocked with an inline amount error. Modal stays open. |
| **FIN-06** | Category | Create + autocomplete | Feature ON, prior category exists | 1. Type a new category and save.<br>2. Open another task and type a prefix. | New category is created. Suggestions list prior private categories. |
| **FIN-07** | Date | Weekly/monthly/yearly | Feature ON | 1. Switch item type to Weekly Goal. | Finance editor is hidden. No silent date assignment. |
| **FIN-08** | Date follow | Edit task date | Feature ON, rows exist | 1. Change the task date.<br>2. Save. | Finance rows follow the resulting task date. |
| **FIN-09** | Summary | Daily / ISO week / month / year | Feature ON, mixed dates | 1. Check daily header for the selected day.<br>2. Check /planning week that crosses 1 Jan.<br>3. Click a summary. | Totals match `[start, end)` aggregation. Breakdown groups by type and category, with task title and memo. |
| **FIN-10** | Privacy | Shared task | Two project members | 1. User A records finance on a shared task.<br>2. User B opens the same task. | User B does not see A's rows and can add their own. |
| **FIN-11** | History | Delete / duplicate task | Feature ON, rows exist | 1. Duplicate the task.<br>2. Delete the original. | Duplicate has no finance rows. Breakdown still shows snapshots after delete. |
| **FIN-12** | Persistence | Partial failure | Feature ON | 1. Cause finance RPC to fail after task save.<br>2. Observe modal. | Modal stays open with entered rows and an inline error. Task is not reported as fully saved. |
