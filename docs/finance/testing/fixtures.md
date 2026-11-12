# Fixtures

All finance tests use loopback encova_test or CI's dedicated encova_test; never hosted records. Current access fixtures are uniquely named synthetic Super Admins, HR, Team Lead and Member, with an explicit test-only grant for the selected synthetic admin. Test setup does not select or alter the real owner. Tests retire their persons and retain immutable audit history until the isolated database resets.

Later accounting acceptance fixture (not yet executed): capital 500,000; loan received 100,000; earned invoice 300,000 and collection 200,000; contractor bill 120,000 and payment 90,000; equipment 60,000; investment 50,000; loan principal repayment 25,000. Expected bank 575,000, AR 100,000, AP 30,000, loan 75,000, profit 180,000, assets 785,000; total debits/credits 1,445,000 each. Separate follow-ups cover 50,000 advance, 20,000 internal transfer and 30,000 customer credit without mixing baseline totals.

## F05 fixture isolation

Tests use only the dedicated encova_test database, owned synthetic owner/selected/denied-role identities and unique F05/B05 account prefixes. Dates are explicitly synthetic (after the largest retained test period, starting in year 6000), never a company fiscal-year decision. Account/period/config receipt/audit history is retained. Cleanup refuses to clear another owner; it releases only its own control singleton/grants and retires owned backend people. The browser reuses separate synthetic owner/read-only users. Usage guards are exercised by operator-only first-use marks with no journal seed; real posting acceptance remains F06–F08. No real owner/demo credential, hosted grant or ERP record is changed by these finance fixtures.

## F06–F10 owned fixtures

Backend ledger/master tests create their own selected/owner/denied identities, mocked Data API roles and unique records. Historical period gaps use 1900–1950 intervals; future-date rejection allocates its own explicit interval in8000–8050, independent of F05 test order. The browser reads date-only SQL as ISO text to avoid host-timezone shifting. Operator-only synthetic cash-GL seeding does not introduce a production bootstrap/proof bypass. Current fixtures never select a real owner. Retained ledger/config/audit history is intentional; owned teardown refuses another owner and cleans only its own control singleton/grants. Browser request-failure injection is test-only and still commits through the real authorized API before verifying canonical retry.
