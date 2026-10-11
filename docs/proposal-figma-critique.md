# Пропозиція: `critique_design` — детектор дизайн-кліше для Figma (2026-10-11)

Статус: пропозиція, чекає на рішення дизайнера. Нічого не реалізовано.

## Ідея

Impeccable (Apache-2.0, github.com/pbakaus/impeccable) має 48 детермінованих
правил проти «AI-вигляду» інтерфейсів, але працює лише з HTML/CSS. Наш MCP
бачить ті самі речі в Figma через Plugin API: шрифти, розміри, кольори,
відступи, вкладеність фреймів, тексти. Пропоную тул `critique_design`, який
обходить піддерево ноди в плагіні і повертає знахідки з id нод, без моделі
і без мережі. Модель потім виправляє їх нашими ж тулами (`set_fill`,
`bind_variable`, `set_auto_layout`, …).

Логіку правил переписуємо під Figma на JS (у плагіні), не копіюємо Rust;
посилання на Impeccable як джерело правил.

## Правила, що переносяться на ноди Figma

Із 48 правил Impeccable 30 мають прямий аналог. Групи:

**Типографіка (10):** `overused-font` (одна родина, типово Inter, на всьому),
`flat-type-hierarchy` (замало різних кеглів), `oversized-h1`,
`extreme-negative-tracking` / `wide-tracking` (letterSpacing),
`tight-leading` (lineHeight < 1.2), `line-length` (ширина тексту / кегль ≈ >75
символів), `justified-text`, `tiny-text` (< 11 px), `skipped-heading` /
`heading-rhythm` (драбина кеглів з провалами), `gradient-text`.

**Колір і контраст (6):** `low-contrast` (WCAG між текстом і найближчим
заповненим предком), `gray-on-color` (сірий текст на кольоровому фоні),
`ai-color-palette` (фіолетово-сині градієнти), `cream-palette`, `dark-glow` /
`radial-halo` (кольорові тіні великого розмиття, радіальні ореоли),
`repeating-stripes-gradient` / `codex-grid-background`.

**Композиція (8):** `nested-cards` (фрейм із заливкою+радіусом усередині
такого ж), `monotonous-spacing` (усі gap/padding однакові), `edge-flush-cards`
(картки впритул до краю), `icon-tile-stack` (квадратна плитка з іконкою над
заголовком), `hero-eyebrow-chip` (пігулка над заголовком), `numbered-section-labels`
(«01», «02»), `text-occlusion` (текст перекритий сусідом), `clipped-overflow-container`
(clipsContent з дітьми за межами), `text-overflow` (текст ширший за контейнер або
з усіченням).

**Текст (3):** `em-dash-overuse`, `marketing-buzzword`, `aphoristic-cadence`,
`repeated-container-text` (той самий плейсхолдер у сусідніх картках).

**Дизайн-система (4):** `design-system-font` / `-color` / `-radius` /
`-font-size` — значення, які не збігаються з локальними змінними і стилями,
коли вони у файлі є (хардкод замість токена).

Не переносяться (18): анімації (`bounce-easing`, `pulsing-dot`, `marquee`,
`blinking-cursor`), рантайм (`broken-image`, `script-error`,
`content-hidden-at-rest`), viewport (`first-viewport-column-overflow`), і
кілька специфічних для HTML.

**Плюс 8 правил, яких в Impeccable немає, бо вони лише про Figma:**
безіменні шари («Frame 123»), відв'язані інстанси там, де є компонент,
змішані шрифти в одному тексті, абсолютно позиціоновані діти всередині
auto-layout, відступи не на сітці 4/8, приховані шари, інтерактивні на вигляд
елементи менші за 44 px, різні радіуси кутів у сусідніх картках.

Разом ~38 правил, кожне з severity `primary` | `advisory`, як в Impeccable.

## Тул

```
critique_design(node_id?, rules?: string[], min_severity?: 'primary'|'advisory', max_findings?: 60)
```

- Без `node_id` — поточне виділення.
- Один `exec` у плагіні; обхід до 2000 нод; контраст рахуємо лише для SOLID.
- Відповідь компактна, під локальні моделі:

```
critique: FRAME "Landing" id=12:34 — 7 primary, 4 advisory (38 rules, 412 nodes)
P low-contrast        TEXT "Subtitle" 12:41  #9aa0a6 on #f5f5f5 = 2.6:1 (need 4.5)  -> set_fill 12:41 #5f6368
P nested-cards        FRAME "Card" 12:50 inside FRAME "Panel" 12:48 (both fill+radius)  -> flatten: remove 12:48 fill
P overused-font       Inter on 100% of 38 texts  -> pick a display face for headings
A monotonous-spacing  gap/padding all = 16 across 12 containers
A design-system-color 9 hardcoded fills while collection "Theme" exists  -> bind_variable
…
```

Кожен рядок: severity, правило, нода з id, факт, і підказка, яким тулом
виправити. Є `format: "json"` для великих моделей.

## Скіл

`skills/figma-mcp/references/critique.md`: стислий рубрикатор на базі
`critique.md` з Impeccable (ієрархія, ясність, емоційний відгук), адаптований
до Figma, і таблиця «знахідка → тул для виправлення». У SKILL.md одна строка в
карті тулів і правило: після збірки екрану один `critique_design` замість
другого скріншота.

## Перевірка

`scripts/smoke-critique.mjs`: будує на канвасі два фікстурні фрейми, «поганий»
(усі кліше навмисно) і «чистий», очікує ≥ 12 знахідок на першому і 0 primary
на другому; видаляє їх. Плюс кейс у `live-tasks.mjs`: «перевір картку на
кліше і виправ», перевірка — після виправлень `critique_design` повертає
0 primary.

## Оцінка (години)

| Етап | Обсяг | Год |
|------|-------|-----|
| A | Тул, обхід, 14 базових правил (типографіка + контраст + nested-cards + spacing + text-overflow + Figma-специфічні 4) | 6–7 |
| B | Решта 24 правила, зокрема дизайн-система і текстові | 5–6 |
| C | Фікстури, smoke, live-кейс | 3 |
| D | Скіл-рубрикатор, README, довідка | 1–2 |
| | Разом | 15–18 |

Етап A вже дає корисний результат; B–D можна робити окремо.

## Поза межами

Жива ітерація в браузері (`/impeccable live`), хуки, автогенерація
зображень. Це все про код, лишається за Impeccable.
