# Architecture

Production target: Next.js + TypeScript + Tailwind on Vercel; Next Route Handlers and shared authorized services form the backend. Supabase provides PostgreSQL, Auth and private Storage. Prisma remains the domain database layer. No Express/NestJS server is required.

Browser → Next Server Components or Route Handlers → verified identity + ACTIVE domain Person → authorized services → Prisma → Supabase PostgreSQL through a bounded transaction-pooler connection. Controlled migrations use a separate direct/session connection. Supabase SSR cookies are verified through the SDK; client metadata is never an authorization source.

A bounded authenticated serverless job endpoint processes PostgreSQL-backed leases/date locks; an approved recurring scheduler must invoke it. A permanent local worker is not assumed on Vercel. Storage setup is private; attachment workflow implementation and tests are outstanding.

See ADR-002 in docs/decisions and the deployment guide in docs/operations. Supabase production authentication is staged behind AUTH_PROVIDER=supabase. Legacy Better Auth remains local compatibility until the hosted cutover is verified; hosted environment guards reject it. Neither provider project nor deployment has been verified through account access in this session.
