# Finance risks

- No posting engine or financial reports exist in this foundation. Screens must not display invented zero balances or readiness claims.
- Owner bootstrap/transfer, last-owner safeguards across generic admin paths, credential takeover prevention and live step-up MFA are pending F04. No owner is seeded, so those capabilities cannot be exposed yet.
- Finance grants are read-only to the runtime role. Controlled owner operations need narrowly reviewed privileges/functions before a management API is added.
- All future finance operations must use the shared access transaction; revocation must use the same Person → advisory-lock order. Direct operator SQL is privileged and must follow the documented protocol.
- PostgreSQL RLS protects against anonymous/authenticated Data API access; the shared server role remains privileged. Application services must check the current actor on every boundary.
- Financial policy and opening data require accountant/company review. No statutory, IFRS or Pakistan tax certification is claimed.
- Finance has no production/staging deployment, financial backup proof or attachment scanning service yet. ERP recovery evidence is not finance recovery evidence.
