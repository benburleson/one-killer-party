# Mystery package implementation guide

The source code—not this guide—is authoritative for the package schema, canonical JSON encoding, validation limits, digest calculation and publication behavior.

## Code map

| Concern | Source of truth |
| --- | --- |
| Shape, types, fields and resource bounds | [`schema.ts`](../../src/lib/mystery-content/schema.ts) |
| IDs, versions, digest syntax | [`ids.ts`](../../src/lib/mystery-content/ids.ts) |
| Stage-specific rules and reference validation | [`validate.ts`](../../src/lib/mystery-content/validate.ts) |
| Canonical JSON bytes and strict parsing | [`canonical-json.ts`](../../src/lib/mystery-content/canonical-json.ts) |
| Hashing, sealing, integrity checks | [`integrity.ts`](../../src/lib/mystery-content/integrity.ts) |
| Safe diagnostic codes | [`issues.ts`](../../src/lib/mystery-content/issues.ts) |
| Publication orchestration and conflict handling | [`publication.ts`](../../src/lib/mystery-content/publication.ts) |
| Trusted package loading (server-only) | [`trusted-loader.ts`](../../src/lib/mystery-content/trusted-loader.ts) and [`trusted-loader-core.ts`](../../src/lib/mystery-content/trusted-loader-core.ts) |
| Private bucket, RLS, registry, RPC and immutability | [`supabase/migrations/`](../../supabase/migrations/) and [`supabase/tests/`](../../supabase/tests/) |
| Operator CLI and command options | [`scripts/mystery-publish.mjs`](../../scripts/mystery-publish.mjs), [`package.json`](../../package.json) |
| User-facing release procedure and incident response | [Production operations](../production-operations.md) |
| Product semantics, timing and spoiler policy | [Content model](../product/mystery-content-model.md), [decisions](../product/decisions-and-open-questions.md) |

Avoid copying TypeScript types, regular expressions, field tables, numeric limits or implementation snippets into Markdown. Change the code and focused tests together when a contract changes; update this map only if a source boundary moves.

## Design invariants

- A mystery package is the complete, private authoring definition; it is **never** a browser response. Spoiler-safe public or character-specific views require separate server-authorized projections.
- The canonical SHA-256 covers the **entire package**, excluding publication metadata because it lives outside the package in the reference and registry. A matching hash proves byte identity, not editorial approval.
- Versions are immutable and resolved by an **exact reference**, never by “latest.” Existing party pins must not silently change; the legacy public Blackwood lobby placeholder is not a private package.
- Publisher upload → readback verification → registry registration is **not atomic** across Storage and Postgres. A failed registration can leave an orphan; inspect it and retry only identical bytes. No automatic overwrite or cleanup.
- The trusted loader fails closed when the version, rule set, registry entry or bytes disagree. It is an integrity boundary, **not** authorization to disclose complete content to a guest.
- Product validation enforces structural consistency but cannot prove mystery solvability, prose spoiler-safety, editorial provenance or human approval. Those remain separate release decisions.

## Testing and development

Use the synthetic fixture in [`tests/unit/fixtures/synthetic-mystery-package.mjs`](../../tests/unit/fixtures/synthetic-mystery-package.mjs), unit tests under [`tests/unit/`](../../tests/unit/), the disposable [mystery integration test](../../tests/integration/mystery-content-local.test.mjs), and [database tests](../../supabase/tests/). Consult [Development environments](../development-environments.md) for how to run the suites. Never use a Production-linked Supabase target for automated tests.

The Production operator path is active and has been exercised with a synthetic version, but the app still has no private dossier/act gameplay. For operational evidence, remaining validation gaps and the current configuration, consult **only** [Production operations](../production-operations.md). Do not duplicate Production status here.
