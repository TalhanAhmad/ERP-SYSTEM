# Finance deployment — not performed

The existing ERP remains live at https://encova-workspace.vercel.app/login. Finance code is built behind FINANCE_ENABLED=false and no hosted migration/grant is part of this foundation delivery.

Before finance staging/live: reviewed migrations and runtime privilege checks, owner setup with fresh MFA, accountant policies/opening reconciliation, full acceptance, isolated financial backup restore, and explicit launch authorization. No paid upgrade, domain purchase, external email or real-data import is implied.

Keep production runtime and migration roles separate. Validate that rerunning setup never widens finance grants. Do not enable the flag before all required schema and owner controls exist. Downloaded data cannot be recalled after access revocation.
