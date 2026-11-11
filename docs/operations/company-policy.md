# Company policy decisions — 11 November 2026

| Item | Decision | Status |
| --- | --- | --- |
| Company working days | Monday, Tuesday, Wednesday, Thursday, Friday, Saturday | Owner confirmed; saved live |
| Weekly off day | Sunday | Derived from the confirmed workweek |
| Shift start/end | 9:00 AM–5:00 PM, Asia/Karachi | Owner accepted; assigned prospectively from 12 November |
| Report deadline | Current configured value retained | Awaiting owner confirmation |
| Leave allowance/rules | Awaiting owner values | Not changed |
| Timezone | Asia/Karachi | Existing supported timezone retained |

The live versioned Settings API saved workweek [1,2,3,4,5,6] and returned version 2. Read-back and actual Settings checkboxes verified Monday–Saturday checked and Sunday unchecked. Company name, cutoff, reminder setting, privileged-MFA setting and overall policy-confirmation state were preserved.

Attendance and leave eligibility use each employee's assigned SchedulePolicy.weekdays and shift snapshot. CompanySettings.workweek does not rewrite those assignments or historical attendance. The owner accepted the proposed 9:00 AM–5:00 PM shift. Three active staff accounts (HR Admin, Team Lead, Member) now have ongoing Monday–Saturday assignments from 12 November. Previous assignment segments end on 11 November and retain their original policy. Super Admin remains exempt. The complete policy set remains unconfirmed until the remaining values are agreed; this does not undo the owner's confirmed workweek choice.

## Attendance assignment verification

Eight targeted live checks passed: one ongoing assignment per active staff member; original policy retained on earlier segments; prior attendance/raw-event hashes unchanged; Thursday, Saturday and Monday resolve to the 09:00–17:00 shift; Sunday resolves to OFF_DAY for all three people; browser schedule rows show the effective date and ongoing range; Root has no new assignment/punch control; no future attendance rows were fabricated during checks. Zero-minute grace and closing buffer were retained from the previous assignments. Report cutoff and leave rules were not modified or confirmed by this shift change.
