# Reports, learning and daily maintenance

## Reports

Daily reports supports scoped dates/status and 25-row pagination. Each person authors one report per company date; optional task links must be their currently accessible assignments. Submitted text is immutable. Current team leads and Root can independently acknowledge or return with a reason. Each submission retains a private immutable content/link snapshot; edits do not overwrite earlier submissions. The first submission records its cutoff and late classification, retained across revisions. Historical reports without timing snapshots are labeled not recorded.

Report Status calculates eligibility from effective assigned weekdays, holidays and approved full-day leave. A report becomes missing only after the configured Asia/Karachi cutoff. Attendance is not used to assess report quality. Scope applies before row counts and drilldowns. HR is deliberately excluded from report obligations, status/narrative pages and report reminder controls under the owner's reduced HR requirements. Root/Lead/Member retain report functions.

## Internships

Root designates a person INTERN in People, creates a department and enrolls an active intern with an independent active Lead/Root mentor. Only one ACTIVE enrollment is allowed. Current mentors manage plans and weekly feedback; interns see only their own enrollment. Root may administer all; HR retains its four focused menus. Mentor reassignment revokes the former mentor's enrollment access.

Milestones move PLANNED → ACTIVE → SUBMITTED → COMPLETED. The mentor links accessible tasks assigned to the intern. The intern submits milestone evidence after submitting all required work. Independent completion requires every linked task to remain approved and assigned to that intern. Root substitutes must provide an override reason; self-review is always denied. Approved-task IDs/versions are audited at completion. Returning/reopening requires a reason; old work/review evidence remains. Completing an enrollment requires completed milestones. Cancel preserves records.

Weekly feedback is limited to overlapping current/past Monday-based weeks, is versioned and visible only to the intern, current mentor and Root. Optional ratings require an explanation and are not aggregated into rankings. No attendance-to-skill score is created. Private report/feedback bodies are omitted from audit entries and safe mutation results.

## Notifications and maintenance

Work roles can disable personal missing-report reminders in Notifications; mandatory account emails and other in-app updates remain. Mark all as read touches only the current recipient. HR retains mark-all-read without unused report preferences. Announcements remain shared across every active account.

The daily pass records maintenance leases, attempts, outcomes and safe errors. It expires abandoned invitation links/mail, creates deduplicated missing-report notifications and retries at most one permitted queued email. Failed/interrupted maintenance can be retried from Operations with a reason. Successful manual HTTP replays retain one run ID; database notification keys prevent duplicate reminders. A maintenance failure is recorded without blocking attendance processing.

Resend test mode still reaches only the owner. Recipient-filtered claims leave blocked recipients' attempts untouched. At-least-once SMTP retry may duplicate mail after an ambiguous provider timeout; provider message deduplication is used where supported. On Hobby the natural daily invocation has hourly precision, so reminder/email throughput is daily and bounded. The worker command uses the same services for an externally scheduled pass; no extra always-on backend is assumed. A verified sender domain and appropriate company scheduling/hosting approval remain required for staff rollout.

Migrations fourteen/fifteen add report operations and learning tables with RLS/server-only grants. Apply before deploying the code. Policies stay unconfirmed demo defaults until the owner explicitly confirms them; existing owner/demo credentials remain unchanged.
