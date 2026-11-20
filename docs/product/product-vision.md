# One Killer Party — Product Vision

**Specification status:** Draft baseline for implementation (v0.3)  
**Last consolidated:** 2026-11-20  
**Audience:** Product owner, designer, engineers, AI coding agents, QA, and playtest facilitators  
**Scope:** MVP / first playable mystery  
**Related documents:** [Gameplay specification](gameplay-specification.md) · [Host and player flows](host-and-player-flows.md) · [Mystery content model](mystery-content-model.md) · [The Blackwood Affair](blackwood-affair.md) · [Decisions and open questions](decisions-and-open-questions.md)

> **Authority and terminology.** This folder is the planned product source of truth. `CONFIRMED` means the user explicitly selected or subsequently accepted the decision. `BASELINE PROPOSAL` means the design was recommended and elaborated in conversation, but was not explicitly approved as an immutable requirement. `OPEN` means a decision, assumption, or contradiction still needs resolution. An engineering agent must not promote a proposal to a confirmed requirement or resolve an open question without documenting the decision. See the [decision register](decisions-and-open-questions.md).

## 1. Purpose and positioning

**Product name:** One Killer Party.

**Working tagline:** “A murder mystery party in your pocket.”  
**Alternate working promise:** “You bring the guests. We bring the mystery.”

**CONFIRMED — Audience and setting:** Adults hosting parties with friends; guests primarily play **together in person**, using personal phones as companions. This is not an online-only multiplayer game. The app guides the evening, and the human host may intervene.

**Product vision:** Make it easy for a host to organize and run an entertaining, immersive murder mystery party without the logistical burden of boxed-game packets, manual clue distribution, or acting as a full-time narrator. The software coordinates the experience; human conversation provides the entertainment.

**Experience principle:** **The app is the director; the guests are the actors; the host is the producer.** The application must make the real-world gathering better rather than compete with it for attention.

**CONFIRMED — Tone:** A **balanced theatrical experience**: mostly spontaneous mingling, investigations, bargaining, bluffing and role-play, punctuated by short scripted public announcements, optional confrontations and a dramatic reveal. Guests are not required to perform long scripts.

**CONFIRMED — AI scope:** AI is **not required in the MVP**. Prioritize a genuinely playable, reliable experience over AI-generated mysteries, an AI narrator or an AI game master. An extensible content model may enable later AI assistance, but AI services must not become a dependency for the MVP.

## 2. Design principles

1. **Party first, phone second (CONFIRMED).** Guests should spend most of the evening talking face to face. Phones deliver discreet prompts, private dossiers, clues and accusations; they should not host the core social interactions.
2. **Make hosting easy (CONFIRMED direction).** The app handles role delivery, phase changes, essential clue releases and the finale. The host may participate as a player and should not be spoiled simply by operating the game.
3. **Everyone matters (CONFIRMED direction).** Every playable character needs reasons to initiate conversations, meaningful private information, secrets and involvement in every act; no one should be decorative filler.
4. **Deception, not arbitrary fiction (CONFIRMED).** Characters can bluff, lie about their actions and conceal information. They may not modify official evidence or claim that fabricated text is an authentic app-issued clue.
5. **Solvability without compliance (CONFIRMED).** Every essential clue is released by game progression, not gated by social-objective completion. Guests can ignore objectives without breaking the mystery.
6. **Safe separation of knowledge (CONFIRMED direction).** Public, character-private, operational-host and solution-only data have different authorization scopes. The host must not receive the murderer or solution merely because they control the party.
7. **Small real product, not a throwaway demo (CONFIRMED direction).** One authored mystery and a focused web application first; architecture can later support a broader library and commercial offerings.

## 3. Core personas

| Persona | Needs | Primary responsibilities | Must not be required to do |
|---|---|---|---|
| **Host** | Configure a party, invite friends, assign characters, control pacing, join the fun | Create party; assign roles; start/pause/advance; launch accusations and reveal | Read the full solution; manually deliver every clue; run a theatre production |
| **Guest / suspect** | Quickly join; understand role; interact with other guests; make deductions | Read dossier; mingle; share or conceal facts; receive clues; accuse | Register a conventional account; complete a checklist to unlock essential evidence |
| **Murderer** | Know guilt and actual sequence; build a believable cover story | Deceive through conversation while respecting official evidence | Edit authoritative game data or impersonate the app |
| **Mystery author/editor** *(future content workflow, not MVP UI)* | Encode a logical, balanced story | Write and validate a structured mystery package | Use AI to invent unverified canon at runtime |
| **Product developer / evaluator** | Demonstrable quality and predictable releases | Implement tests, access boundaries, deployment and documentation | Rely on this chat to discover requirements |

## 4. MVP experience at a glance

**CONFIRMED core:** In-person social play; phones as companions; host-assigned roles; murderer knows they are the murderer; hybrid clue discovery; balanced theatrical tone; no AI requirement; placeholder story before a polished commercial mystery.

**BASELINE PROPOSAL for first playable prototype:**

| Attribute | Initial target |
|---|---|
| Mystery | *The Blackwood Affair* (authored placeholder) |
| Player count | **Exactly 8** for first full playtest; support 6–10 is a **future design goal**, not a requirement to make one mystery work for 6 or 10 immediately |
| Victim | Non-playable Edmund Blackwood |
| Duration | About **90 minutes**: Act I 20, Act II 25, Act III 25, finale 20 (suggestions only, not hard deadlines) |
| Structure | Setup/lobby → three acts → accusations → reveal → completion |
| App | Responsive mobile web application; host access on mobile/desktop |
| Mystery catalog | One structured authored story; no marketplace in MVP |
| Public moments | Welcome, murder announcement, recovered-document revelation; theatrical final reveal |
| Evidence | Initially six public clues and eight character-specific private clue/knowledge releases |
| Entry | Shareable link / join code; guest should not need email registration |
| Account model | Host email sign-in proposed; guests anonymous authenticated sessions proposed, subject to security validation |

The earlier general product goal of **6–10 participants** remains a roadmap aim. It must **not** be read as verified Blackwood compatibility with variable party sizes. Optional characters, alternate assignments and solutions have not been authored.

## 5. MVP feature boundaries

### In scope for the first complete playable experience (baseline proposal)

- Host creates a party for the single supported mystery.
- Host obtains a private invitation/join code and invites guests.
- Guest joins without a conventional email/password sign-up, chooses a display name and receives their assigned character's accessible content.
- Host sees lobby attendance and assigns each of eight unique roles using **public role descriptions**.
- Guest views public identity, private background, relationships, social objectives and released clues.
- Host starts, pauses/resumes and advances acts; scheduled durations remain advisory.
- The game engine makes public/individual content available at authorized acts; connected guests receive updates.
- Guests interact **in person**; social missions are advisory and do not require in-app verification.
- Host opens accusation phase; each participant records a final suspect, motive and method.
- Authorized reveal shows the canonical solution, narrative reconstruction and optional detective scoring/awards.
- Access-control tests ensure that role secrets and solution-only data are not leaked.
- Responsive design, automated validation, a working deployed build, and a complete real-world playtest.

### Out of scope for MVP (agreed direction)

- AI-generated or AI-personalized mysteries; AI game master, narration and hint bot.
- Purchases, subscriptions, payments, marketplace, commercial booking flows.
- Native iOS/Android apps; remote-only play; in-app player-to-player chat.
- Mandatory task verification, rewards-gated essential evidence, physical QR scavenger hunts, GPS mechanics.
- Fully fledged authoring CMS; broad game library; sophisticated leaderboards or analytics.
- A mandatory TV/shared display; optional shared display may be developed later.

## 6. Experience goals and measures

These are **proposed experiment targets**, not achieved metrics or release promises:

| Measure | Proposed target or evaluation |
|---|---|
| Host setup | Set up and assign eight roles in **under 10 minutes** once guests are known |
| Guest onboarding | Join and understand essential character information without live technical support |
| Play length | Full eight-person game can be completed in about **90 minutes** plus optional extensions |
| Screen time | Aim for roughly **5–10 minutes of active phone use** per guest over 90 minutes; measure rather than enforce |
| Social engagement | Every guest has at least two interactions initiated by an objective or clue per act; observe, do not require tracking |
| Clue reliability | Correct release, exactly once logically, to the correct audience, despite retries/reconnect |
| Security | Zero premature reveals of solution-only data in black-box authorization tests |
| Satisfaction | Post-party feedback on pacing, clarity, social participation, deductive fairness and fun |

**Open measurement design:** How social engagement, difficulty and enjoyment will be instrumented without undermining privacy or encouraging phone use is not determined.

## 7. Implementation/hosting foundation

The user reported the following foundation as **completed**: VS Code, Node.js and Git installed on Mac; Next.js application running locally; private GitHub repository created and pushed; Supabase development project created; environment variables securely configured; landing page working locally; Vercel deployment live; DNS configured for an application subdomain. These are **user-reported setup facts**, not guarantees of production-grade readiness or end-to-end functionality.

**Selected stack/direction:** Next.js, React, TypeScript, Tailwind CSS; Supabase/PostgreSQL for persistent data, auth and realtime events; Vercel application hosting; GitHub version control and review workflow; VS Code and AI coding tools on macOS. Use server-authoritative game logic and a versioned, data-driven mystery definition.

**Domain pattern (CONFIRMED preference):** Root domain for public marketing/brand; `www` may redirect to root; **`app.<owned-domain>` for gameplay**. The real domain string and DNS operator were not captured here. DNS is reported set up; avoid changing it without an explicit deployment task. No inference should be made that the marketing site already exists or that the subdomain has been verified from every network.

**Repository:** `benburleson/one-killer-party` was identified in the connected GitHub account in this conversation; default branch `main`. Public portfolio visibility is a future decision, not an instruction to publish private game content now. The project also has a GitHub issue-to-PR workflow in development; preserve branch protections and review/CI requirements described in repository documentation.

**Environments:** Local development, GitHub PR preview builds, and deployed production-facing app are the intended workflow. Separate Supabase development and production projects were recommended, but **only a development Supabase project was confirmed**; do not presume that production DB, migrations or secrets are configured.

## 8. Readiness and release sequencing

1. **Documentation baseline:** These six files reviewed as product source of truth; every unresolved item captured in decision register.
2. **Infrastructure verification:** Confirm domain routing, environment variables, deployment protection, database project, version control and secret handling.
3. **First vertical slice:** Create party → guest joins → host sees participant → assign role → start phase → release a public/private clue → guest reconnects.
4. **Full game mechanics:** Three acts, private/public knowledge controls, accusation/reveal, host pacing controls, scoring if retained.
5. **Complete Blackwood content:** Validate the authored timeline, required clues and character interactions; address content inconsistencies.
6. **Technical QA:** Access-control, transition idempotency, concurrent actions, reconnect, small-screen usability and deployment tests.
7. **In-person eight-player playtest:** Measure clarity, engagement, balance, dramatic pacing and spoiler isolation; iterate before broader release.

## 9. Guidance for autonomous coding agents

- Start with the relevant specification section and its `OPEN` entries in [decisions-and-open-questions.md](decisions-and-open-questions.md).
- Implement **only** a scoped issue; include acceptance tests and documentation impact in the pull request.
- Treat game content as **data** and policy enforcement as **server-side logic**, never as instructions trusted from the guest browser.
- Do not silently add commercial features, AI dependencies, new user roles, or incompatible content mechanics.
- Keep production-facing host/guest data free of unreleased spoiler material. A private GitHub repo protects source access but **does not** protect deployed clients from bundled content.
- When the spec has ambiguity or contradictions, record a decision proposal and stop short of cementing an unsupported behavior.