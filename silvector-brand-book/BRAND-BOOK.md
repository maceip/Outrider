# Silvector brand book

Pulled 2026-11-14 from the public pages around `https://www.silvector.com/perspectives`, plus the shared home page and `https://www.silvector.com/how-silvector-decides` because they use the same mark, type, and CSS. Files in `assets/` are the originals. Voice lines are in `PHRASES.md`.

Footer on the film pages: © 2026 AG47AI.

## Mark

There is no picture logo on the site. The header mark is the word Silvector, set in Source Sans 3 at weight 600, 1.125rem, letter-spacing -0.02em, color `#eceae4`, with no underline.

The favicon is a 32×32 black square with one white horizontal rule, 24px wide and 1px tall, centered. File: `assets/mark/favicon.svg`. It matches the horizon in `assets/stills/hero-orbit.jpg` (1280×720, black sky, one bright line, gray cloud field).

Film frames use a small chevron beside the word, top left, with a frame index top right (`1 / 3 · The customer` and `Illustrative scenario` on the customer poster).

## Color

Site tokens in `assets/css/site.css`:

| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | `#0c0d0f` | page ground, dark only |
| `--raise` | `#141618` | cards, day strip, door field |
| `--fg` | `#eceae4` | text, pressed controls |
| `--muted` | `#c4c2ba` | body secondary |
| `--dim` | `#a8a69e` | kickers, labels |
| `--line` | `#2c2e33` | hairline rules |
| `--stone` | `#c8bba6` | current step, Silvector column |
| `--allow` | `#9aafa2` | let through |
| `--deny` | `#c4a8ab` | block |
| `--step` | `#c4a574` | step up / verify |
| `--price` | `#b9a27a` | price outcome |

Form underlines use `#8b8d93`. Film video ground is `#000`.

Storyboard ink is a step off the CSS: ground `#0B0F14`, stroke and type `#F4F1EA`, 1.5px, no fill except the type.

Outcome rows get a 2px inset bar: allow green, price gold, step gold, deny rose. Meter, edit, and slow stay on `--line`.

## Type

- Site: Source Sans 3, weights 400 and 600, files in `assets/fonts/`. Fallback: Avenir Next, Segoe UI, sans-serif.
- Body 1.125rem, line-height 1.6. H1 clamps from 2.75rem to 4.25rem, line-height 1.05, letter-spacing -0.03em, max about 16ch. H2 clamps 1.75rem to 2.15rem.
- Storyboard labels: IBM Plex Sans, 13px. The site CSS does not load that font.
- Small labels: 0.75–0.8rem, letter-spacing 0.12em, uppercase, color `--dim`.
- Measure: lede max 36rem, support copy max 40rem, page column `min(960px, 100% - 3rem)`. The four-column board widens to 1280px.

## Layout habits

Dark only (`color-scheme: dark`). Sticky bar, 4.25rem, background `rgba(12, 13, 15, 0.92)`, bottom hairline. Sections are `.band` with a top hairline and about 4.75rem of padding.

Controls are quiet. Links are the text color with an underline offset, not a button color. Pressed chips invert to light on dark. The door scan submit is a pill (`border-radius: 999px`). Chapter stops are the same pill outline. Inputs on the home form are underline-only. The door field is the one filled input: `--raise` ground, 6px radius.

Hit targets stay at least 44px. Focus is a 2px `--fg` outline, 3px offset. Reduced motion kills animation. The current nav item is underlined.

Columns of the visit are four cards: hairline border, `--raise` fill, 4px image radius. Silvector's column uses a `--stone` border. Step copy sits on a 2px `--stone` left rule. Receipt labels are the uppercase dim style.

The day strip is one rounded bar in three colors: through `--allow`, verify `--step`, blocked `--deny`. The page says those counts are simulated demo traffic from a fixed seed, not shop data.

## Diagrams

Four storyboards, each 640×360, three panels, same frame. Files in `assets/diagrams/`.

| File | Panels | Drawing |
| --- | --- | --- |
| `human.svg` | 01 Greet, 02 Confirm, 03 Receipt | person, check marks, document |
| `agent.svg` | 01 Door, 02 Check, 03 Cart | doorway, crosshair, cart line |
| `seller.svg` | 01 Shop, 02 Hours, 03 Receipt | shop awning, two clocks, document |
| `silvector.svg` | 01 Noticed, 02 Decided, 03 Why, written down | target, three lines with a decision mark, checked receipt |

Film posters are 1280×720 stills in `assets/film/`. The customer poster is a light delegation card on black: Agent, May, Where, On its own, Above $300, Expires, and a black pill, Sign with passkey. Caption sits in the black margin under the card.

## Motion and film

Films do not autoplay. The page says the narration is a synthetic voice, captions are burned in, and a captions track is in the player menu.

| Side | Length | Files |
| --- | --- | --- |
| Customer | 77s | `customer.mp4`, `customer.vtt`, `customer-poster.jpg` |
| Agent | 83s | `agent.mp4`, `agent.vtt`, `agent-poster.jpg` |
| Seller | 71s | `seller.mp4`, `seller.vtt`, `seller-poster.jpg` |
| Silvector | 80s | `silvector-view.mp4`, `silvector-view.vtt`, `silvector-view-poster.jpg` |

WebM twins of the same four films are on the site and were not copied. MP4 is the file the pages offer as the download.

## Steps and outcomes

Visit steps: Greet, Assess, Verify, Permit or Step up, Log.

Decision steps on the technical page: Greet, Assess, Verify, Decide, Log. The page says no model sits in the decision path, and the budget is 25 ms. Past that, the request passes and the receipt records `bypass.timeout`.

Nine outcome names: Allow, Meter, Price, Edit, Step-up, Throttle, Tarpit, Decoy, Deny. Deny is the only stop.

Receipt headings: Principal, Agent, Delegation, Action, Policy, Risk, Outcome, Evidence. Risk is a band, and the copy says a band is not a number.

## Pages read

- `https://www.silvector.com/perspectives`
- `https://www.silvector.com/perspectives/customer`
- `https://www.silvector.com/perspectives/agent`
- `https://www.silvector.com/perspectives/seller`
- `https://www.silvector.com/perspectives/silvector`
- `https://www.silvector.com/how-silvector-decides`
- `https://www.silvector.com/`
