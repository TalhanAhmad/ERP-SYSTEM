# Posting rules — required, not yet implemented

One shared atomic engine must validate exact decimal-string PKR inputs, positive one-sided lines, balanced totals, active accounts, open periods, current access and expected draft versions. NUMERIC(20,2), deterministic HALF_UP line rounding and permanent source/action identities are required. Generic ERP Idempotency/Audit must not store finance payloads.

Posted entries and source amounts are immutable, guarded in PostgreSQL at commit; corrections create dated opposite journals/events. Period/settlement/access locks must share a documented deterministic order. Typed protected-control adjustments update their subledgers and GL together. No network/file work is performed inside posting transactions.

F05–F08 build and prove these rules; the current foundation does not claim them implemented.

## F05 primitives now implemented

See [exact PKR and setup rules](setup-and-money.md). Exact string validation, high-precision line rounding and retained account/period configuration exist. Journal balancing, immutable ledger lines and actual postings do not yet exist (F06–F08). F05 synthetic usedAt tests exercise guards directly; they do not simulate a complete accounting fixture or create journal entries.

Lock order for configuration: admin serialization 987661; actor Person/exclusive finance access lock; current settings row; structural advisory lock 629815; target row, receipt/audit. List/detail readers hold shared structural lock through their count/items snapshot, after the existing shared current-person/grant authorization. A BEFORE STATEMENT structural trigger takes 629815 before any account/period row lock, including operator SQL. Future posting must integrate deterministic period/account/ancestor row locks and set usage atomically with lines; usage-only marks intentionally skip the structural statement lock. F06 must test posting-versus-config races and must not acquire the config lock after holding posting rows. No deadlock-free posting claim is made by F05.
