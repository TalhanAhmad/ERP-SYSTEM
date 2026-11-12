# Screens

Implemented: /finance, a protected setup-status screen with a return-to-workspace link. It shows no amounts, inactive buttons, sample transactions or false reports. Unselected users receive an unavailable page; the nav link appears only for an active selected administrator when the feature flag is enabled.

Planned F09 onward: Template B searchable registers, compact filtered totals, 25 rows/default and 100 maximum, stable server sorting, detail drawers, keyboard/mobile support and explicit loading/error/stale states. Cash register rows represent posted cash movements only. Draft previews and Post confirmation precede immutable postings; correction is a reversal/credit workflow.

F04 adds /finance/access: current owner/selected-access status, owner-only grant/revoke/transfer/cancel forms, recipient acceptance, current-password/fresh-TOTP inputs, version conflicts, bounded recent restricted audit history and no plaintext credential persistence. Read-only selected users cannot access owner controls; unselected/lower-role users cannot open the page.

## F05 setup screens

/finance/accounts has searchable active/archive/type filters, bounded server pagination (25 default, 100 maximum) and stable code/id sorting. /finance/accounts/new and /finance/accounts/{id} expose owner-only classification, parent group, control/contra/cash-equivalent mapping and archive/reactivate; used mapping inputs are disabled while names remain editable. /finance/periods lists explicit inclusive ranges and owner creation; /finance/periods/{id} permits owner amendments and unused voiding, with OPEN/VOID/CLOSED read-only states as appropriate. Selected administrators can read lists/details/history but receive no mutation controls. Unselected/lower roles are denied server-side.

Owner actions require reasons, fresh password and hosted fresh TOTP, with private responses and version/conflict messages. Credentials clear after each request; retry state contains business fields only. Forms are disabled before hydration and have POST fallback. Named focusable horizontal table regions support keyboard scrolling on mobile. Empty/invalid-filter/no-record states are explicit; no fake balances or fiscal defaults are displayed. Account parent options show the first 100 active groups and retain the current parent; searchable complete parent selection/shared drawers remain F09–F10 work.
