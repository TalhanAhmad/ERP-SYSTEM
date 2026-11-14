# Private commercial projects through F27

One FinanceProjectProfile binds to the existing immutable ERP project ID. A project manager’s role or membership confers no financial rights. Only current selected ACTIVE Super Admins can read or write these records; the ordinary ERP project DTO has no contract, rate or financial relationship fields. Its Project finance link appears only for selected administrators with finance enabled.

## Agreements and changes

A draft stores client, original PKR value, billing model, terms and evidence. Separate confirmation requires a positive agreement, signed date no later than today in Pakistan and explicit approval evidence. It freezes the original client/value/terms and a contract snapshot, including the client and project name at confirmation. Subsequent master/name/archive changes retain that evidence. Cancelling an unconfirmed profile retains its identity and can be reopened; closing a confirmed plan pauses new planning until reviewed reopening.

Variations are explicit signed increases/decreases. A draft contributes nothing to contract value; separate approval requires reviewed evidence and a nonfuture signed date. Original agreement plus approved signed variations must stay between zero and the supported PKR maximum. Serialized approval/deferred constraints prevent competing reductions from jointly creating a negative contract. Approved variations cannot be edited/voided; a further reviewed amendment records the next change. Normalized references stay reserved for approved history; voided drafts remain auditable.

## Billing plans and actual invoices

Billing milestones have an exact planned value, description, expected billing/payment dates and supporting evidence. Confirmation records an approved commercial plan; it creates no invoice, revenue, receivable, cash or journal. Confirmed values are retained, with explicit cancellation once active invoice relationships are released. Plans exceeding current contract value show an advisory review message rather than blocking financial recognition.

A milestone may link multiple real posted invoice lines. Each line has at most one active milestone relationship; if billing spans milestones, use separate reviewed invoice lines. Eligibility requires the same immutable project ID and commercial client, PKR, a posted invoice and positive original line net. The value/snapshot comes from the source, never a trusted browser override. Links display original billed net before later credits; current settlement/credit history remains on the invoice. This annotation is not an AR allocation, new billing entry or recognized-revenue calculation. Project financial result definitions follow in F28.

Correcting a relationship marks it RELEASED with actor/time/reason and retains both source and audit history; a new eligible relationship can then be made. Active links must be released before milestone cancellation. Deferred checks independently reject forged original net or snapshot. The original invoice, lines, frozen source JSON and ledger are not modified, preserving earlier posting identities and idempotency.

## Boundaries and verification

Commercial writes have current grants/provider session, fresh proof, strict body, canonical Origin/CSRF, permanent request key, version checks and private audit; they never invoke the journal emitter. Accounting posting and period checks remain on actual invoices/movements. Archived operational projects retain financial history and eligible links. Runtime gets SELECT plus the checked command; helpers/sequences/raw mutations and Data API roles are denied. Registers and relationships have complete bounded stable pagination and current-access option searches. Financial amounts and audit snapshots use exact strings.

Migrations and all fixtures are isolated to encova_test. No real client contract, company policy, hosted finance schema/grant or financial transaction is adopted. Supporting references are retained on commercial sources; original invoice evidence stays on the invoice.
