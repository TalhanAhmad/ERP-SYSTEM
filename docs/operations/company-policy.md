# Company policy decisions — 11 November 2026

| Item | Decision | Status |
| --- | --- | --- |
| Company working days | Monday, Tuesday, Wednesday, Thursday, Friday, Saturday | Owner confirmed; saved live |
| Weekly off day | Sunday | Derived from the confirmed workweek |
| Shift start/end | 9:00 AM–5:00 PM, Asia/Karachi | Owner accepted; assigned prospectively from 12 November |
| Report deadline | 5:00 PM, Asia/Karachi | Owner confirmed; live value verified |
| Leave allowance/rules | HR approval for each request; no fixed annual quota in the app | Owner confirmed; existing workflow verified |
| Timezone | Asia/Karachi | Existing supported timezone retained |

The live versioned Settings API saved workweek [1,2,3,4,5,6] and returned version 2. Read-back and actual Settings checkboxes verified Monday–Saturday checked and Sunday unchecked. Company name, cutoff, reminder setting, privileged-MFA setting and overall policy-confirmation state were preserved.

Attendance and leave eligibility use each employee's assigned SchedulePolicy.weekdays and shift snapshot. CompanySettings.workweek does not rewrite those assignments or historical attendance. The owner accepted the proposed 9:00 AM–5:00 PM shift. Three active staff accounts (HR Admin, Team Lead, Member) now have ongoing Monday–Saturday assignments from 12 November. Previous assignment segments end on 11 November and retain their original policy. Super Admin remains exempt. The owner has now confirmed the workweek, shift hours, report deadline and approval-based leave workflow. The generic full-settings confirmation flag remains unchanged; no new timing tolerance, payroll entitlement or company launch approval is inferred.

## Attendance assignment verification

Eight targeted live checks passed: one ongoing assignment per active staff member; original policy retained on earlier segments; prior attendance/raw-event hashes unchanged; Thursday, Saturday and Monday resolve to the 09:00–17:00 shift; Sunday resolves to OFF_DAY for all three people; browser schedule rows show the effective date and ongoing range; Root has no new assignment/punch control; no future attendance rows were fabricated during checks. Zero-minute grace and closing buffer were retained from the previous assignments. Report cutoff and leave rules were not modified or confirmed by this shift change.

## Report deadline confirmation

The owner explicitly confirmed 5:00 PM Pakistan time. The live cutoff was already 17:00, so no settings mutation or version bump was required (version remains 2). Verified API and browser input, read-only before/exact/after-cutoff status behavior against the assigned workday, Sunday exemption and unchanged existing report timing/version metadata. Other settings and the overall policy-confirmation flag remain unchanged. Leave policy was subsequently confirmed as HR approval-only with no fixed annual quota in the application.

## Leave workflow confirmation

The owner selected HR approval-only, retaining the existing application behavior without an annual balance/quota. Employee requests start PENDING and need an independent authorized decision; they are not automatically approved. HR can approve/reject requests, while Super Admin retains existing oversight/cancellation authority. Scheduled days, holidays/off-days, overlap and attendance-conflict protections still apply. This choice does not define paid/unpaid payroll treatment or a separate contractual entitlement.

Eight live checks passed using one newly owned synthetic Member and the persistent HR test login: pending state; self-approval denial; actual HR browser approval/reviewer; ON_LEAVE status with no punch events and duplicate reservation denial; actual rejection releasing the reservation; Sunday-only range denial; exactly four HR main-menu entries; cancellation/retirement of only the new fixture with all persistent exploration accounts retained. Existing employee leave requests were not changed. No code/migration/deployment or quota-setting mutation was needed.
