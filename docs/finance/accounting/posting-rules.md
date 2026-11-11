# Posting rules — required, not yet implemented

One shared atomic engine must validate exact decimal-string PKR inputs, positive one-sided lines, balanced totals, active accounts, open periods, current access and expected draft versions. NUMERIC(20,2), deterministic HALF_UP line rounding and permanent source/action identities are required. Generic ERP Idempotency/Audit must not store finance payloads.

Posted entries and source amounts are immutable, guarded in PostgreSQL at commit; corrections create dated opposite journals/events. Period/settlement/access locks must share a documented deterministic order. Typed protected-control adjustments update their subledgers and GL together. No network/file work is performed inside posting transactions.

F05–F08 build and prove these rules; the current foundation does not claim them implemented.
