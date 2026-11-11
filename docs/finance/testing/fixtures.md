# Fixtures

All finance tests use loopback encova_test or CI's dedicated encova_test; never hosted records. Current access fixtures are uniquely named synthetic Super Admins, HR, Team Lead and Member, with an explicit test-only grant for the selected synthetic admin. Test setup does not select or alter the real owner. Tests retire their persons and retain immutable audit history until the isolated database resets.

Later accounting acceptance fixture (not yet executed): capital 500,000; loan received 100,000; earned invoice 300,000 and collection 200,000; contractor bill 120,000 and payment 90,000; equipment 60,000; investment 50,000; loan principal repayment 25,000. Expected bank 575,000, AR 100,000, AP 30,000, loan 75,000, profit 180,000, assets 785,000; total debits/credits 1,445,000 each. Separate follow-ups cover 50,000 advance, 20,000 internal transfer and 30,000 customer credit without mixing baseline totals.
