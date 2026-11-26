# One Killer Party

An in-person, phone-assisted murder-mystery game. Guests interact face-to-face; the app manages invitations, public roles and lobby coordination. The initial mystery is **The Blackwood Affair**.

## Current state (November 2026)

- **Live application:** https://app.onekillerparty.com (host entry: `/host`); marketing: https://onekillerparty.com.
- **Implemented:** host magic-link authentication, lobby creation, invitations and rotation, anonymous guest join and host-assisted recovery, public character assignment, and synchronized lobby views.
- **Gameplay boundary:** parties remain in `LOBBY`. Private dossiers, timed release, act progression, and solution reveal are **not** implemented. The legacy Blackwood lobby pin is a **public roster placeholder**, not a private published mystery package.
- **Private content foundation:** versioned mystery package schema/validation/canonical SHA-256, private Supabase Storage and immutable Postgres publication registry, MFA-gated dedicated publisher with Cloudflare Turnstile and macOS Keychain. A **synthetic test package** (`synthetic-mystery/1.0.0-test.1`) was published to Production and independently checked against registry and Storage metadata. **No real Blackwood mystery package has been published.** The trusted loader is not exposed through host/guest routes.
- **Production identity:** the Custom Access Token Hook `private_mystery.production_publisher_hook` is enabled. Owner-tested host sign-in, guest join and publisher TOTP/role authentication succeeded. This does **not** mean private content is available to players.
- **Delivery:** AI-assisted GitHub issue → isolated agent branch → tests/PR → human review and merge. Production changes, content publication and security configuration require explicit owner action.

For evidence levels and remaining operational limits, see [Production operations](docs/production-operations.md). These are owner-reported Production observations, not direct dashboard access by the repository.

## Documentation map

| Need | Read |
| --- | --- |
| What the game should become | [Product vision](docs/product/product-vision.md), [gameplay](docs/product/gameplay-specification.md), [host/player flows](docs/product/host-and-player-flows.md) |
| Story and unresolved product choices | [Blackwood Affair](docs/product/blackwood-affair.md), [decision register](docs/product/decisions-and-open-questions.md) |
| Lobby database and authorization | [Lobby persistence](docs/architecture/lobby-persistence.md) |
| Private content boundaries and code contract | [Mystery architecture](docs/architecture/mystery-content-architecture.md), [package contract](docs/architecture/mystery-content-package.md) |
| Start, test and troubleshoot development | [Development environments](docs/development-environments.md) |
| Operate Production, authenticate publisher, back up and recover | [Production operations](docs/production-operations.md) |
| Agent and PR conventions | [Agent instructions](.github/copilot-instructions.md), [workflow setup](docs/workflow-setup.md) |

Product specs distinguish **confirmed** requirements from proposals; no implementation agent should invent an answer to an open question.

## Develop

Preferred environment: [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json) in VS Code Dev Containers or Codespaces (Node 22 and Chromium). Keep forwarded service ports private. See [development environments](docs/development-environments.md) for disposable Supabase configuration and callback/origin constraints.

```sh
npm ci
npx supabase start
npx supabase db reset --no-seed
npx supabase test db
npm run dev
```

Use local-only, uncommitted `.env.local` values pointing at the disposable Supabase stack. Do **not** run automated tests against Production.

```sh
npm run test:unit
npm run lint
npx tsc --noEmit
npm run build
npm run test:integration:mystery
npm run test:integration:owner
npm run test:e2e -- --project=desktop-chromium --project=mobile-chromium
```

Run local integration suites only with their documented disposable Auth/database prerequisites. GitHub CI uses [Copilot setup steps](.github/workflows/copilot-setup-steps.yml) and its own Linux runners, not your dev container.

## Security and maintenance

This is a public repository. Never commit mystery secrets, private player content, passwords, JWTs, service-role keys, TOTP setup keys or Production backups. New gameplay must expose only server-authorized, character-specific projections; storing a complete private package does **not** authorize disclosure. Production migrations, hooks, Keychain enrollment and publishing are owner-operated and separately approved.

**Current limitations:** the Production rehearsal established public-anonymous Storage denial but did **not** make a live authenticated-host JWT download-denial test. The November 24 encrypted database backup predates publisher provisioning; take a new encrypted backup before the next substantial Production change. See the operations guide for full recovery limits and publication gates.
