# Company policy decisions — 11 November 2026

| Item | Decision | Status |
| --- | --- | --- |
| Company working days | Monday, Tuesday, Wednesday, Thursday, Friday, Saturday | Owner confirmed; saved live |
| Weekly off day | Sunday | Derived from the confirmed workweek |
| Shift start/end | Awaiting owner values in Pakistan time | Not changed |
| Report deadline | Current configured value retained | Awaiting owner confirmation |
| Leave allowance/rules | Awaiting owner values | Not changed |
| Timezone | Asia/Karachi | Existing supported timezone retained |

The live versioned Settings API saved workweek [1,2,3,4,5,6] and returned version 2. Read-back and actual Settings checkboxes verified Monday–Saturday checked and Sunday unchecked. Company name, cutoff, reminder setting, privileged-MFA setting and overall policy-confirmation state were preserved.

Attendance and leave eligibility use each employee's assigned SchedulePolicy.weekdays and shift snapshot. CompanySettings.workweek does not rewrite those assignments or historical attendance. Shift hours were requested before prospective employee-calendar configuration. The complete policy set remains unconfirmed until the remaining values are agreed; this does not undo the owner's confirmed workweek choice.
