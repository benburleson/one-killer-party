# One Killer Party

An in-person, phone-assisted murder-mystery game. Guests interact face-to-face; the app manages invitations, public roles and lobby coordination. The initial mystery is **The Blackwood Affair**.

## Current state (November 2026)

- **Live application:** https://app.onekillerparty.com (host entry: `/host`); marketing: https://onekillerparty.com.
- **Implemented:** host magic-link authentication, lobby creation, invitations and rotation, anonymous guest join and host-assisted recovery, public character assignment, and synchronized lobby views.
- **Gameplay boundary:** parties remain in `LOBBY`. The repository provides an on-demand server boundary for an assigned participant's own published pre-start dossier, but no dossier UI; timed release, act progression, and solution reveal are **not** implemented. The legacy Blackwood lobby pin is a **public roster placeholder**, not a private published mystery package.
- **Private content foundation:** versioned mystery package schema/validation/canonical SHA-256, private Supabase Storage and immutable Postgres publication registry, MFA-gated dedicated publisher with Cloudflare Turnstile and macOS Keychain. A **synthetic test package** (`synthetic-mystery/1.0.0-test.1`) was published to Production and independently checked against registry and Storage metadata. **No real Blackwood mystery package has been published.** Repository changes do not imply Production deployment or activation.
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

Use the [dev container](.devcontainer/devcontainer.json) or Codespaces, and follow [Development environments](docs/development-environments.md) for local Supabase setup, safe environment variables, build/test commands and troubleshooting. `package.json` defines the authoritative npm scripts; `supabase/config.toml` and migrations define the disposable database setup. Never point development tests at Production.

## Security and maintenance

This repository is public. Never commit private story content, player data, passwords, JWTs, MFA secrets, privileged Supabase credentials or Production backups. Code review, migrations, live Auth configuration and each mystery publication have separate approval gates. For procedures and current operational evidence, consult [Production operations](docs/production-operations.md); do not infer live status from source alone.
