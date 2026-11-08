# Private task-submission attachments

Implemented in the attachment milestone; real-provider acceptance is recorded in the test results after deployment. This extends the original link-only scope under the accepted Supabase Storage architecture.

## Workflow and access

The active assignee can upload drafts while a task is IN_PROGRESS or CHANGES_REQUESTED. Supported files: PDF, PNG, JPEG and UTF-8 plain text; non-empty, up to 4 MiB (shown as 4 MB). At most 10 outstanding drafts and 100 retained files per task. File signatures/UTF-8 and filenames are checked on the server; these checks are not malware scanning or complete document-format validation.

Select ready files in the submission form. The domain transaction binds each selected file to the same task, uploader and submission revision. Submitted metadata cannot be updated or deleted, enforced by a database trigger. Each revision keeps its own files; resubmission does not replace earlier evidence. HTTPS artifact links still work.

Drafts are readable only by the uploader within current project access. Submitted files follow existing task/project visibility, including super-admin access. Every download verifies the active linked account and current project scope again after provider I/O. The app returns a forced download with a Unicode-safe filename, nosniff and private/no-store caching; it never returns a public or signed bearer URL. Account deactivation blocks subsequent requests, but cannot revoke bytes already downloaded.

## Storage and failure recovery

Bytes live in the private encova-private Supabase bucket, under generated task/file UUID paths. Bucket/object keys, digests, retry keys and leases stay server-only. Browser clients use authenticated Next.js endpoints; anonymous/authenticated Supabase Data API roles receive no direct file policy.

An upload reserves a PENDING domain record with a two-minute claim, writes through the Storage API outside the database transaction, then rechecks authorization/task state before marking READY and auditing success. Storage calls have 15-second timeouts. Reusing the same key/content recovers a lost response; the adapter never overwrites an existing object and only recovers a prior write when its digest matches. A different payload under the same key is rejected.

Removing a draft first marks DELETING so a concurrent submission cannot consume it. Provider deletion is retryable; final completion marks DELETED and audits once. A process crash or ambiguous provider operation can leave a pending reservation/object. Retain the record for diagnosis and retry/removal; do not delete arbitrary object prefixes. A broad orphan-cleanup/retention dashboard is not implemented. Already submitted files are historical evidence and must not be removed by that workflow.

The application caps bytes below the [Vercel Function request/response limit](https://vercel.com/docs/functions/limitations). Larger direct-to-Storage uploads/resumable transfer are not implemented. The bucket's 10 MiB ceiling does not increase the application's 4 MiB limit. Adapter behavior follows [Supabase upload](https://supabase.com/docs/reference/javascript/storage-from-upload) and [private download](https://supabase.com/docs/reference/javascript/storage-from-download) guidance.

## Operation and verification

Apply the eighth additive migration through the controlled migration connection. It creates the Attachment table, grants the existing restricted server role, enables RLS, revokes browser/Data API access and adds immutable-history/matching-submission constraints. supabase/setup.sql remains safe to reapply for the existing policy pattern.

Local compatibility mode does not silently store uploads on the application filesystem. It reports unavailable unless explicit Supabase Storage configuration is supplied. Browser/SDK contract tests use an isolated loopback in-memory HTTP fixture, never a production storage fallback; live acceptance uses the actual project.

Use only synthetic files/accounts during acceptance. Check type/signature and exact size boundaries, read/write scope, revision preservation, retry/concurrency, failed deletion, integrity mismatch and account/membership revocation. Real SMTP, recurring scheduling, privileged MFA, backup restore, retention and broader release work remain separate requirements.
