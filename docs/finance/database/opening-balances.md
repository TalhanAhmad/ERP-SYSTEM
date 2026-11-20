# Reviewed opening balances

F41 implements a private owner-approved cutover, with no live books imported. [Import rules](../accounting/opening-balances.md) define the retained format, subledger treatment, clearing proof and date boundary. The original UTF-8 JSON and SHA-256 are retained in PostgreSQL; the current grant is checked for every download. Candidate81 was deployed afresh in owned acceptance databases. The primary dedicated test database contains the same additive schema and verified migration checksum; no development/hosted database was migrated.
