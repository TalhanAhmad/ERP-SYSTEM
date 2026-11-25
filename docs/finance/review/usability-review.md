# Finance usability review — 26 November 2026

Talha selected a review of the local finance screens and fixes for observed usability issues. Hosting stays local. The review covers the finance landing page, profit and loss, invoices/register, new invoice, new bill, new journal and report export form on desktop and mobile.

## Observed issues and changes

| Issue | Result |
| --- | --- |
| Flat finance navigation occupied 503px on a 390px-wide invoice/form screen | A compact navigation panel keeps daily shortcuts visible and puts the full directory in a native disclosure, with search, eight named groups and an active-page indicator |
| Landing page exposed only a small subset of modules under Finance setup | Finance overview now provides grouped links and explanations for every existing module |
| Switching from historical profit and loss to balance sheet reset to today's cutoff | Balance sheet at period end preserves the chosen end date; the explicitly named return link opens profit and loss for that cutoff's month |

All 50 original navigation destinations are retained, along with the three January 2020 demo report shortcuts. The directory and navigation share one list. Links avoid automatic prefetching of the entire private finance directory. The native disclosure works with keyboard controls and still exposes its links before client JavaScript; search and active-page marking are client enhancements. A no-results message helps recover from an unmatched search. The directory does not grant permission: existing server-side finance selection and role boundaries remain in force.

## How to use it

Open http://localhost:49278/login and use a synthetic account from the private `.local/finance-demo/logins.json`. Choose Finance, then a grouped link or Browse finance pages. Search by page or group name, such as loans, reports or supplier. Daily invoice/bill/journal shortcuts remain visible while the full menu is closed. On a report, use Balance sheet at period end to keep the selected cutoff; the return link explicitly opens that month rather than claiming to reconstruct an arbitrary earlier date range.

These changes do not alter report calculations, posting services, money precision, database schema, permissions or company policy. Lower roles and unselected administrators remain denied finance access. Email, external Storage/scanner and hosted finance setup remain unconnected/deferred for this local demo.

## Verification

- All 358 unit tests passed in 6.99 seconds. Strict TypeScript and clean ESLint passed.
- Eight focused Chromium tests passed in 23.8 seconds: two new usability journeys, finance selection/revocation and anonymous/lower-role denial, existing statement/ledger money checks and core accessibility. Keyboard opening/search, empty search recovery, active-page indication, menu reset after navigation, 360px layout/WCAG and report cutoff/export-filter preservation are covered.
- Seven actual retained-demo browser/security scenarios passed again: six real role sign-ins, isolated cookies, exact bank/profit/assets/trial totals, normal draft/void, private CSV/PDF hashes, denial boundaries, mobile/WCAG/keyboard and unchanged nine posted sources. [Financial evidence](evidence/usability-financial-verification.json) records this separate local run.
- All 49 existing module-directory pages were also opened at both desktop and mobile widths: 98 read-only page checks returned HTTP 200 with no page-level horizontal overflow. The separate overview route is covered in the representative screen run. [Directory evidence](evidence/usability-directory.json) records every route.
- All 14 actual screen layouts (seven routes at 1440px and 390px) returned HTTP 200 with no page-level horizontal overflow. The collapsed mobile menu measured 231px compared with 503px before; the invoice heading moved from 831px to 556px from the viewport top. [Screen results](evidence/usability-screens.json) and [comparison](evidence/usability-comparison.json) preserve the measurements. Four representative desktop/mobile overview and profit-report accessibility scans passed. Visual screenshots were inspected directly.
- Normal production, Supabase-shaped production and separate demo webpack builds passed. The demo was stopped through its ownership-checked command and restarted with retained identities/books; no reseeding occurred. The local app remains running at the same URL.
- All 250 API/documentation contracts, local documentation links, Word package/XML/relationships, configured private-value checks and git whitespace checks accompany publication. No migrations or accounting services changed, so additional full local PostgreSQL regression was not required for this UI pass; fresh PR CI independently runs the complete suite.

One setup attempt correctly refused fixture preparation because the shell's default database was not encova_test. The target guard stayed intact; preparation and the final eight-browser run were repeated with the explicit dedicated loopback test URL. An unused import produced a lint warning and was removed; final lint is clean. The earlier eight-browser pass (22.1 seconds) is retained separately and not added to the distinct eight-test count.

The previous main CI on aeae742 passed; it is baseline evidence, not proof of these new UI changes. Source is published on finance/usability-review for PR review. Fresh CI and merge are separate gates. No real company policy acceptance, hosted finance setup, production deployment or paid upgrade occurred.

## Visual review

Mobile finance overview:

![Compact mobile finance navigation and overview](evidence/usability-mobile-overview.png)

Desktop finance overview:

![Grouped desktop finance directory](evidence/usability-desktop-overview.png)

Retained sample profit:

![Unchanged exact January sample profit on mobile](evidence/usability-mobile-profit.png)
