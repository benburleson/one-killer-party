# One Killer Party branding

## Identity and status

One Killer Party is social, theatrical and mysterious: slightly sinister, but
playful and approachable, not horror or gore. The approved direction is an
ivory masquerade mask over a vertically centered crimson dagger, within a
dark charcoal and deep crimson circular emblem. The mask suggests a party and
hidden identities; the dagger hints at the mystery.

The shipped [SVG icon](../src/app/icon.svg) is the simplified, small-size
approximation of that direction, not the full-resolution illustration. The
[Apple touch icon](../src/app/apple-icon.png) is a 180px raster of the same
artwork. No separate full emblem or social preview image is currently in the
repository; their eventual artwork and treatment remain provisional.

## Icon palette

These are the exact colors in the SVG, not a prescribed palette for the
entire app:

| HEX | Role |
| --- | --- |
| `#171417` | Outer charcoal background |
| `#9D001B` | Deep crimson emblem |
| `#D31B36` | Crimson ring outline |
| `#201A1D` | Inner charcoal and mask eye openings |
| `#B90D2A` | Crimson dagger |
| `#FFF0D8` | Ivory mask and dagger outlines |

The light mask and dark eye openings provide separation at small sizes. Keep
the dark outer background intact on both light and dark browser chrome; check
the mask and dagger at 16px and 32px whenever the icon changes. For larger
uses, preserve the square proportions and leave breathing room around the
emblem; no formal clear-space measurement has been approved.

The SVG is the browser favicon and available app icon. The PNG is the Apple
touch icon. There is no separate ICO, installed-app manifest icon, or social
preview image at present. Do not assume the small favicon is a finished
large-format social graphic; use the approved motif if a preview is added.

## Typography

The app loads Geist and Geist Mono through `next/font/google` and exposes them
as Tailwind sans and mono font variables. The current body CSS explicitly
uses Arial, Helvetica, sans-serif. These reflect the implementation, not a
newly approved typography system.

## Metadata and copy

- Title: **One Killer Party**
- Description: **Host an unforgettable murder mystery party. Bring your guests together for a night of secrets, suspects, and surprises.**
- Canonical origin: `https://app.onekillerparty.com`
- Open Graph defaults: website, site name and title One Killer Party, the
  description above, and the canonical app URL.
- Twitter defaults: summary card with the same title and description. No
  social image is configured.

## Usage

Use the supplied artwork without stretching, recoloring, low-contrast
background substitutions, or extraneous effects. Retain the mask and
centered dagger when adapting it, and verify legibility at the intended size.
Do not revert to Next.js branding or the discarded cocktail/keyhole concept.
