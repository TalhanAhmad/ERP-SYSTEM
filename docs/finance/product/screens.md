# Screens

Implemented: /finance, a protected setup-status screen with a return-to-workspace link. It shows no amounts, inactive buttons, sample transactions or false reports. Unselected users receive an unavailable page; the nav link appears only for an active selected administrator when the feature flag is enabled.

Planned F09 onward: Template B searchable registers, compact filtered totals, 25 rows/default and 100 maximum, stable server sorting, detail drawers, keyboard/mobile support and explicit loading/error/stale states. Cash register rows represent posted cash movements only. Draft previews and Post confirmation precede immutable postings; correction is a reversal/credit workflow.

F04 adds /finance/access: current owner/selected-access status, owner-only grant/revoke/transfer/cancel forms, recipient acceptance, current-password/fresh-TOTP inputs, version conflicts, bounded recent restricted audit history and no plaintext credential persistence. Read-only selected users cannot access owner controls; unselected/lower-role users cannot open the page.
