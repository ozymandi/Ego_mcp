# Example — design agency site, brutalist, in Hermes

A worked run of [workflow 1](../01-create-from-scratch.md): a design
agency website with a standard page set, pure blue + white with acid-lime
accents, brutalist style, a blackletter display face. Hermes with the
`design` profile and the `figma-mcp` skill; Qwen3.8 27B or Gemma 4 31B.

Copy the messages in order. Lines starting with `agent:` show the tools you
should see Hermes call; if it does something else, correct it in the next
message.

## Brief (message 0)

```
Product: "RAW/STUDIO", a design agency. Site: Home, Work, Case study
(template), Services, About, Contact. Desktop 1440 first; mobile later.
Audience: founders and product leads who want work that does not look like
every other SaaS site. Tone: blunt, confident, short sentences.
Style: brutalism. Hard edges (radius 0), 2–4px black borders, raw grid with
visible gutters, oversized type, no shadows, no gradients, no illustrations;
photos as flat black-and-white blocks.
Colors: pure blue #0000FF as the main surface and brand; white #FFFFFF;
acid neon lime #CCFF00 for accents only (buttons, highlights, tags); black
#000000 for text and borders.
Type: a blackletter display face for headings (try "Grenze Gotisch",
"UnifrakturMaguntia" or "Pirata One"; check with listAvailableFontsAsync,
fall back to "Inter Black" if none is installed) and a monospace for body
and UI ("JetBrains Mono" or "IBM Plex Mono", fallback "Inter").
Rules: lime is never used for text on white or on blue (contrast); white
text on blue, black text on lime and white. Keep every surface flat.
Avoid: purple/blue gradients, icon tiles, pill chips, rounded cards, drop
shadows, "seamless"/"elevate" copy.
```

Send the brief first on its own; Hermes keeps it in the conversation.

## 1. Scratch page, fonts, tokens

```
you:    Create a page "WIP / RAW-STUDIO" and switch to it. Check which of
        these fonts are available: Grenze Gotisch, UnifrakturMaguntia, Pirata
        One, JetBrains Mono, IBM Plex Mono. Then create a variable collection
        "Brutal" (one mode) with COLOR variables color/blue=#0000FF,
        color/white=#FFFFFF, color/lime=#CCFF00, color/black=#000000,
        color/ink-on-blue=#FFFFFF, color/ink-on-lime=#000000; FLOAT variables
        space/8, space/16, space/24, space/40, space/64, space/120, border/2,
        border/4, radius/0=0.

agent:  use_figma (createPage) → set_current_page
        use_figma (listAvailableFontsAsync filtered to those families) → "Grenze Gotisch: yes, JetBrains Mono: yes …"
        create_variable_collection {name: "Brutal"}
        create_variable ×6 COLOR, ×9 FLOAT
        list_variables {collection_id} → 15 variables
```

If no blackletter face is installed, install one in Figma (Google Fonts are
available in Figma desktop) and ask Hermes to re-check; do not let it fall
back silently to Inter for headings.

## 2. Text styles

```
you:    Create text styles with use_figma: Display/XL = Grenze Gotisch Bold
        160/0.9, Display/L = Grenze Gotisch Bold 96/0.95, Heading/M = Grenze
        Gotisch Bold 48/1.0, Mono/Body = JetBrains Mono Regular 18/1.5,
        Mono/Small = JetBrains Mono Regular 14/1.5, Mono/Label = JetBrains
        Mono Bold 14/1.2 with letter-spacing 8% (for all-caps labels).

agent:  use_figma (loadFontAsync per face, figma.createTextStyle ×6, set fontName/fontSize/lineHeight/letterSpacing)
        → ids of the six styles
```

## 3. Atoms

```
you:    Build these component sets on this page, bound to Brutal tokens,
        radius 0, borders border/4 in color/black:
        - Button: Kind=Primary|Secondary|Lime × State=Default|Hover.
          Primary = blue fill, white label; Secondary = white fill, black
          label; Lime = lime fill, black label; Hover = fill shifts to black
          with the Kind color as label. Label in Mono/Label, padding
          space/16 × space/24, auto-layout hug.
        - Tag: lime fill, black Mono/Label text, padding 4 × 12, border/2.
        - Nav/Link: Mono/Label text, State=Default|Active (Active has a
          lime underline block 4px).
        - Divider: a 4px black horizontal rule, width FILL.
        - Icon: 24×24 frames with Lucide icons arrow-up-right, arrow-right,
          menu, x, in black.
        Report every set id and its variants.

agent:  use_figma per set (createAutoLayout + texts + solid() + bind_variable via setBoundVariableForPaint) → combine_as_variants
        insert_icon ×4 inside 24×24 frames → create_component ×4
        bind_variable (fill, padding, strokeWeight) where the snippet did not bind
        list_components {name_pattern: "^(Button|Tag|Nav|Divider|Icon)"}
```

Acceptance: `critique_design` on the page shows no `design-system-*` and no
`low-contrast` findings on the Lime button (black on lime is 15:1; white on
lime would fail).

## 4. Molecules and organisms

```
you:    Build: Nav/Bar (1440 wide, black top and bottom border/4, logo
        "RAW/STUDIO" in Heading/M on the left, five Nav/Link on the right,
        a Lime Button "Start a project" with Icon/arrow-up-right);
        Section/Header (Display/L title + Mono/Body intro, two columns 8/4
        on a 12-col grid, gutter space/24); Card/Work (a flat gray #D9D9D9
        image block 4:3 with border/4, title Heading/M, Tag row, a black
        Divider); Footer (blue fill, white text, three columns: address,
        links, a Display/L "Say hi" with the email). All radius 0, no
        shadows.

agent:  create_instance ×N with properties → use_figma for composition (createAutoLayout, FILL sizing, borders as strokes with strokeAlign INSIDE)
        create_component for each organism
        get_screenshot {node_ids: [...]} once
```

## 5. Pages

Build each page as a 1440-wide frame named `Page/<Name>`, from the
organisms. One message per page keeps each build retry-safe.

```
you:    Page/Home at 0,0: Nav/Bar; a hero with Display/XL "WE MAKE THINGS
        THAT DO NOT LOOK LIKE THINGS." on a blue surface (white text), lime
        Tag "DESIGN AGENCY — KYIV / REMOTE", two Buttons (Lime "Start a
        project", Secondary "See work"); a Work grid of 4 Card/Work on
        white with space/40 gaps; a Services strip: four rows separated by
        Dividers, each Heading/M service name + Mono/Body one-liner + Icon/
        arrow-right; a black band with Display/L "3 weeks from brief to
        launch." in lime; Footer. Realistic content, no lorem.

you:    Page/Work at 1600,0: Nav/Bar; Section/Header "Work"; a 2-column
        grid of 8 Card/Work with Tags (Brand, Web, Product); Footer.

you:    Page/Case-study at 3200,0 (template): Nav/Bar; Display/L project
        name on blue; meta row in Mono/Small (client, year, scope, Tags);
        a 12-col grid of image blocks (one full-width, two half, one 8/4);
        a "What we did" list with Dividers; a next-project link in Display/L
        with Icon/arrow-right; Footer.

you:    Page/Services at 4800,0: Nav/Bar; Section/Header "Services"; four
        blocks, each a blue surface with white Heading/M, Mono/Body list of
        deliverables, a Lime Button; a process row 01–04 ONLY if you can
        make it not look like a template — otherwise a plain Divider list;
        Footer.

you:    Page/About at 6400,0: Nav/Bar; Display/L manifesto in three short
        sentences on white; team grid (6 flat gray portrait blocks, name in
        Mono/Label, role in Mono/Small); clients row as Mono/Label names
        separated by lime squares; Footer.

you:    Page/Contact at 8000,0: Nav/Bar; left column Display/L "Tell us
        what you are making."; right column a form: Name, Email, Budget
        (Tags as radio: <10k, 10–30k, 30k+), Message (textarea), Lime
        Button "Send"; all fields white with border/4, Mono/Body text,
        labels in Mono/Label; Footer.

agent:  create_frame → set_auto_layout → create_instance ×N → create_text ×N → use_figma for grids → get_screenshot once per page
```

## 6. Critique

```
you:    Critique every Page/* frame and fix the primary findings. Brutalism
        is intentional, so keep: oversized headings, wide tracking on
        all-caps labels, radius 0, 4px borders, the numbered 01–04 process
        list if you kept it. Fix: any contrast failure, text overflow,
        occlusion, tiny text, hardcoded colors, default layer names. List
        what you kept and why.

agent:  critique_design {node_id: Page/Home} → fixes → critique_design {min_severity: "primary"} → 0
        … per page
        get_screenshot {node_ids: [all pages], max_px: 1024}
```

Findings to expect and what to do:

| Finding | Expected? | Action |
|---------|-----------|--------|
| `low-contrast` on lime text or blue text on blue | yes, first build | black on lime, white on blue (`set_fill` / `bind_variable`) |
| `oversized-h1`, `wide-tracking`, `numbered-section-labels` | advisory, intentional | keep; say so |
| `text-overflow` on Display/XL hero | likely | `textAutoResize = 'HEIGHT'` + FILL width (`use_figma`) |
| `design-system-color` | if the agent typed #D9D9D9 for image blocks | add `color/image-block` and bind |
| `edge-flush-cards` | brutalist grids often touch the edge | keep if the gutter is deliberate |
| `monotonous-spacing` | possible | make section gaps space/120 vs inner space/24 |

## 7. Mobile and hand-off

```
you:    Make Page/Home-mobile at 390 wide from Page/Home: single column,
        Display/XL → Display/L, nav collapsed to the logo and Icon/menu,
        Work grid one column, buttons FILL width. Critique it.

you:    Move all Page/* frames to a new page "Site", keep components on
        "WIP / RAW-STUDIO" renamed to "Components". Write the hand-off:
        get_node_spec per page and per component set into the "handoff"
        workspace, tokens.json from list_variables, icons as SVG, 2x PNGs.
```

From here, [workflow 3](../03-atomize-for-handoff.md) step 5 applies as is;
the site is already atomized because it was built from components.

## What a good first screenshot looks like

Blue hero filling the viewport with a white blackletter headline that
nearly touches the edges; a lime tag and two square-cornered buttons under
it; black 4px rules between sections; work cards as flat gray blocks with
heavy borders and blackletter titles; a monospace body everywhere else; no
rounded corners, shadows or gradients anywhere. If the screenshot shows
soft gray cards with 12px radius, the model fell back to defaults: repeat
"radius 0, border/4, no shadows" and re-run the page prompt.
