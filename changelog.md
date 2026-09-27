# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release dates are derived from git tags. Entries below `## [Unreleased]` are
not yet packaged; move them under a tagged version once a release is cut.

---

## [0.0.611]

### Fixed
- `history.jsonl`: виправлено некоректне падіння `-2` у `garageLocked` за 13 вер.:
  3862 → **3864**. Значення слотів знову монотонно неспадні на цьому відрізку.
- `sync_now.sh` + WebUI: **перероблено парсинг метрик гаража** з `Garage.dat`.
  Раніше `garageTotal` рахував усі картки (3959) і плутався із заблокованими,
  через що «вільні слоти» та «під гаражем» були невидимі. Тепер чотири окремі
  метрики: місткість (`state:1` + 1 = **3914**), збережені/заблоковані
  (`locked:true` = **3904**), вільні слоти (різниця = **10**), «під гаражем» /
  незабрані машини (`state:0` = **46**).
- WebUI: у вкладці «Аналітика» додано окрему картку `.an-garage-metrics` з
  чотирма плитками (всього / заблоковано / вільно / у триманні) замість
  змішування місткості гаражу з кількістю збережених машин.
- WebUI: **«Бої» → «Заїзди»** (Races) — перейменовано ключі `an_battles_*` →
  `an_races_*`, класи `.an-battles-*` → `.an-races-*`, функції
  `renderBattlesDashboard` / `bindBattlesDashboard` → `renderRacesDashboard` /
  `bindRacesDashboard`, а також фільтр `td2tdr_battle_period` →
  `td2tdr_race_period`.
- WebUI: денна динаміка заїздів більше не «приплюскується» гігантським
  кумулятивним підсумком першого дня встановлення (10 вер.). Для періоду
  «Усе» дельти рахуються строго між сусідніми знімками, а перший запис
  пропускається — інакше добові значення виглядали б як нулі.

### Changed
- WebUI: вкладка **«Гараж» видалена** повністю — навігаційна кнопка, панель
  ресурсів і статистики, парсер карток (`upgradeKey`, `renderUpgradeBar`,
  `loadGarageStats`) та відповідні виклики. Метрики гаражу переїхали в
  «Аналітику».
- WebUI: число денного темпу в блоці прогнозу обгорнуте в
  `<span class="an-forecast-num">` і збільшене до `1.28em`; підпис «в день»
  залишився стандартного розміру.

---

## [0.0.612] – 2026-09-27

### Fixed
- WebUI: усунено хибні від'ємні дельти місткості слотів (**-53** та сусідні
  спади на кшталт -59/-62) при продажу, злитті чи розблокуванні авто.
  Причина: лічильник `state:1` падає разом із кількістю машин, що не означає
  «віднімання слотів». Місткість тепер трактується як неспадний ліміт і
  показує лише чисте розширення (`+N` слотів):
  - `applyMonotonicFloor()` — running max по серії `garageSlots`;
  - `recordSnapshotIfNeeded()` — нижня межа від попереднього максимуму при
    записі нового знімка в історію;
  - `sync_now.sh` — обмеження бере максимум по **усіх** попередніх знімках
    (`sort -n | tail -n1`) замість лише останнього рядка, тож воно працює
    навіть на несортованій історії.
  Рядок «🛍️ витрачено» для гаража більше не будується. Перевірено на реальних
  даних: негативних дельт **0**.

### Changed
- Git: `history.jsonl` відписано від індексу (`git rm --cached`) і додано в
  `.gitignore` — це локальні дані, їм не місце в репозиторії. `temp/` і далі
  ігнорується.
- WebUI: блок гаража об'єднано в **єдину картку «Гараж»**. Прибрано дублювання,
  де `renderMetric(..., "garageSlots")` малював картку «Гараж (слотів)», а поруч
  стояв окремий `.an-garage-metrics` із тим самим заголовком. Чотири плитки
  (всього / заблоковано / вільно / у триманні) тепер вбудовано в цю саму
  картку через слот `preChartHtml`; заголовок скорочено до «Гараж» / «Garage».
- WebUI: **відкочено типографіку** денного числа в блоці прогнозу —
  `.an-forecast-num` повернуто до стандартного розміру (`font: inherit`)
  після збільшення до `1.28em` у 0.0.611.
- WebUI: заголовок секції заїздів перейменовано на «Статистика заїздів» /
  «Race Statistics».
- WebUI: мітки дат на осі графіка «Динаміка заїздів у часі» переведено у
  компактний числовий формат `DD.MM` (`27.09`) замість текстового місяця
  (`27 вер.`). Прибрано `writing-mode: vertical-rl`, додано
  `tabular-nums`/`nowrap`, висота графіка 92→104px (на вузьких екранах
  70→88px), щоб горизонтальні підписи не обрізалися й не накладалися.

---

## [0.0.613] – 2026-09-27

### Fixed
- WebUI: **виправлено парсер історії версій** (`parseChangelog`) — усі релізи
  серії 0.0.60x+ були невидимі у вікні «Історія версій». Стара регулярка
  `/^#\s+(.+)/` ловила лише заголовки H1, а весь changelog давно перейшов на
  формат Keep a Changelog (`## [0.0.612] – 2026-09-27`), тому в UI потрапляв
  лише заголовок документа. Нова регулярка приймає H1 і H2, необов'язкові
  дужки та префікс `v`, і коректно відсікає `# Changelog` як заголовок
  документа, а не реліз. Результат: **1 → 27** розпізнаних релізів
  (26 випущених + `[Unreleased]`).
- WebUI: виправлено визначення бейджа «Поточна». `changelog.md` історично не
  відсортований newest-first (0.0.611 стоїть вище за 0.0.612), тому стара
  логіка `isLatest = idx === 0` присвоювала бейдж старішому релізу.

### Added
- WebUI: підтримка підрозділів H3 (`### Fixed`, `### Changed`) — назва
  підрозділу зберігається для кожного пункту, а `renderChangelogItems()`
  групує послідовні пункти під спільним заголовком `.cl-group-title`. Записи
  без підрозділів (старий вбудований `CHANGELOG_FALLBACK`) рендеряться як
  раніше.
- WebUI: семантичне сортування релізів за спаданням (`compareVersionsAsc()`)
  — коректний порядок незалежно від послідовності у markdown-файлі, з
  обробкою пре-релізних тегів (`0.0.505-beta` < `0.0.505`). Секція
  `[Unreleased]` сортується в кінець і не привласнює бейдж «Поточна».
- WebUI: окремий бейдж `cl_unreleased` («НЕ ВИПУЩЕНО» / «UNRELEASED») для
  секції `[Unreleased]` та іконка класи `.cl-group-title`, `.cl-version-note`
  для заголовків підрозділів і підписів релізу.
- Витягування номера версії та дати окремо: заголовок
  `## [0.0.612] – 2026-09-27` дає версію `0.0.612` і дату `2026-09-27`, а
  `# v0.0.527 — опис` — версію `0.0.527` й опис у полі `note`.

---

## [0.0.614] – 2026-09-27
Release focus: **CI/CD** — release workflow більше не пише в `master`; **changelog** — прибирання накопичених записів.

### Changed
- CI/CD: release workflow **більше не комітить `update.json` у `master`**. Крок
  «Update update.json on master via API» (PUT через Contents API) прибрано, разом
  із `fetch-depth: 0` і коментарем про пуш у гілку. Причина: кожен реліз
  породжував додатковий коміт від CI одразу після пушу тега, через що наступний
  локальний реліз вимагав ручного `stash` → `rebase` → `stash pop`, щоб не
  затерти згенерований SHA-256. `master` тепер лишається чистим, а наступні
  релізи не створюють дрейфу гілки.
- CI/CD: підрахований **SHA-256 публікується як асет релізу**
  (`dist/update.json` + `td2tdr_v<ver>.zip.sha256`), а не як коміт у гілку.
  Значення лишається доступним для користувачів і CI, але більше не змінює
  історію `master`.

### Removed
- Changelog: секція `[Unreleased]` очищено від ~25 накопичених пунктів, які
  давно були реалізовані (Prestige Cap Alert, unified Battles dashboard,
  `maxLine`/`preChartHtml` у `renderSparkline`/`renderMetric`, неінтерактивний
  інсталятор `UNATTENDED`/`SKIP_DISCLAIMER`, атомарні записи `history.jsonl`,
  W/D/L у `getGarageSnapshot()`, видалення мертвих блоків battles тощо). Усі
  ці зміни вже описані у відповідних секціях випущених релізів (0.0.527,
  0.0.605, 0.0.610), тому дублювати їх у черзі майбутньої роботи не було сенсу.

### Known limitation
- Оскільки CI більше не записує `sha256` у `update.json` у `master`, значення
  у гілці лишається порожнім (`""`). Перевірка цілісності архіву в застосунку
  guard-иться умовою `if (remote.sha256)`, тому оновлення **працюватиме без
  неї** — але без перевірки хеша. Актуальний хеш публікується в асетах
  релізу; за потреби його можна перевірити вручну. Повернення перевірки
  можливе через вбудований маніфест у ZIP, підпис релізу або окрему гілку `ci/`.

---

## [0.0.615] – 2026-09-27
Release focus: **стабільність синхронізації** — аудит обробників кнопок вкладки «Синхронізація».

### Fixed
- `sync_now.sh`: додано **атомарний PID-lock** (`mkdir` + `trap` на `EXIT/INT/TERM`)
  з виявленням протухлих блокувань (`kill -0`): якщо процес-власник загинув,
  блокування перехоплюється, а не блокує скрипт назавжди. Раніше блокування
  не було взагалі, тому паралельні запуски змагалися за файли копій і запис
  історії.
- WebUI: єдиний гвард **`syncInFlight`** для синхронізації. Кнопка
  «Синхронізувати та відкрити» звільнялась за ~300мс, тоді як `sync_now.sh`
  працював далі (`wait_stable` — до 8 ітерацій по ~0.4с на файл), тому
  повторний клік у цьому вікні піднімав **паралельний** процес. Тепер кнопка
  лишається неактивною до завершення фонового запуску.
- WebUI: `refreshAll()` більше не **загубує результат `syncFile()`**. Раніше
  `await syncFile()` ігнорувався, тож при збої копіювання UI мовчки показував
  «Оновлено» зі старими даними. Тепер — тост, запис у журнал і зупинка ланцюжка.
- WebUI: `refreshAll()` отримав обробник `catch`. Ланцюжок мав лише `finally`,
  тому будь-який reject з `refreshInner()`/`renderAnalytics()` вилітав як
  unhandled rejection — без жодного повідомлення користувачеві.
- WebUI: прибрано `.catch(() => {})`, що ковтав помилки синхронізації мовчки.
- WebUI: усунено **дедлок кнопки**. `updateSyncGate()` навмисно нічого не
  робить, поки на кнопці лишився клас `.validate`/`.error` (знімається за
  таймером на 1250/2500мс). Якби синхронізація завершувалася швидше, кнопка
  лишилася б `disabled` назавжди; тепер прапорці знімаються явно.
- WebUI: `#refreshBtn` під час роботи отримує `disabled` — візуальний стан
  відповідає реальному гварду (раніше лишався лише клас `.spinning`, тож
  кнопка виглядала доступною, хоча кліки глухо відкидалися).
- **Ізольовано тимчасові файли історії**: `history.jsonl.tmp` → 
  `history.jsonl.tmp.$$` (shell) і `history.jsonl.tmp.<uniq>` (WebUI). Раніше
  WebUI `saveHistory()` і `sync_now.sh` писали в **одне й те саме** ім'я, тож
  `rm -f` одного з процесів зносив файл, який інший уже записав, а `mv -f`
  переносив обріжаний вміст у `history.jsonl` — втрата знімків історії.
  Відтворено тестово: зі спільним tmp знімок губився (`mv: cannot stat`),
  з унікальними — ні.
- WebUI: прибрано дубльоване визначення i18n-ключа `an_accuracy` у EN-блоці
  (було 3 визначення замість 2; значення ідентичні, тому нешкідливе).

---

## [0.0.616] – 2026-09-27
Release focus: **прибирання залишків логів та UX** — ізоляція ротації `sync.log`, розділення гвардів оновлення.

### Fixed
- `service.sh`: ізольовано тимчасовий файл ротації логу —
  `${LOG}.tmp` → `${LOG}.tmp.$$`. Статичний шлях дозволяв паралельному
  `log()` з іншого процесу перезаписати файл у польоті, після чого `mv`
  переносив обрізаний вміст у `sync.log`. Завершує серію ізоляцій тимчасових
  файлів після `history.jsonl.tmp` (0.0.615).
- WebUI: розділено гвард початкової перевірки та ручного оновлення.
  `refreshEssential()` більше не ділить `refreshInFlight` із `refreshAll()`;
  для нього введено окремий `essentialInFlight`, який зберігає **проміс**
  поточного запуску. Якщо користувач натискає «Оновити» під час стартової
  перевірки, клік більше не відкидається мовчки: показується тост
  «Триває початкова перевірка…», виконування підв'язується до поточного
  промісу й продовжується одразу після його завершення — два записи
  історії не намагаються пройти одночасно.
- WebUI: помилка очікування стартової перевірки більше не ламає ручне
  оновлення — вона логується, а ланцюжок іде далі.

### Known limitation
- `refreshEssential()` наразі **не викликається** ніде: автооновлення було
  вимкнено свідомо (див. коментар у кінці `DOMContentLoaded`), тому
  `essentialInFlight` завжди `null`, а згаданий вище шлях є **захисним
  (defensive)**. Він прибирає приховану спільність прапорців, яка відтворила
  б баг із мовчки відкинутим кліком, якщо автоперевірку знову увімкнуть.
  Функцію можна безпечно видалити, якщо автоперевірку не планується
  відновлювати.

---

## [0.0.617] – 2026-09-27
Release focus: **прибирання коду** — видалення мертвої стартової перевірки.

### Removed
- WebUI: видалено **неактивну функцію `refreshEssential()`** та її гвард
  `essentialInFlight` разом із блоком підв'язування в `refreshAll()`
  (введеними у 0.0.616). Автооновлення було вимкнено свідомо, тож функція
  не мала жодного виклику й лишалась мертвим кодом. Це закриває
  `Known limitation` із 0.0.616.
- WebUI: видалено i18n-ключі, які стали невикористовуваними після
  видалення функції: `toast_essential_in_progress`, `log_essential_wait`,
  `log_essential_failed` (UKR + ENG).
- Жодних інших мертвих символів не виникло: усі допоміжні функції, які
  використовував `refreshEssential()` (`saveStateCache`, `checkGarageExists`,
  `formatBytes`, `setTabIndicator`), мають інших викликів і лишилися в коді.

---

## [0.0.618] – 2026-09-27
Release focus: **швидкість синхронізації та хибні помилки копіювання** — аудит вкладки «Синхронізація».

### Performance
- Shell: оптимізовано `wait_stable` у `sync_now.sh` — 8 ітерацій зі зростаючими
  паузами 0.3→0.5с замінено на 6 кроків по **0.15с** з вимогою **трьох
  однакових замірів розміру поспіль** (два могли б збігтися випадково під час
  короткої паузи у флаші гри, тому гарантію стабільності збережено).
  Виміряно на реальному файлі ~4 МБ: стабільний випадок **0.33с → 0.17с**,
  гірший (файл змінюється) **3.70с → 0.66с**. Оскільки на прогін припадають
  два файли (`Garage.dat` + `user.dat`), гірший сценарій скорочено з ~7.4с до ~1.3с.

### Fixed
- WebUI: усунуто **хибну помилку «Копіювання у Download: ПОМИЛКА»**. Причина
  була не в копіюванні: скрипт перевіряє результат через `/data/media/0` з
  ретраями (`verify_file`), тоді як браузер читає `/storage/emulated/0`, а
  `checkGarageExists()` робив **один** `stat` без повтору. Android FUSE ще не
  показував щойно записаний файл — і вдале копіювання позначалося помилкою
  (типовий симптом: помилка о 12:32, успіх о 12:34). Тепер
  `checkGarageExists({retries: 3, delayMs: 400})` дає кешу FUSE потрібні
  ~400–1200мс на дозрівання метаданих. Для справді відсутнього файлу помилка
  лишається (тестовано: retry обмежені, false-success неможливий).

### UX
- WebUI: кнопка «Синхронізувати та відкрити» більше не лишається
  заблокованою на весь час копіювання — вона звільняється одразу після
  відкриття браузера, а статус/індикатори/аналітика оновлюються у фоні.
  Важливо: **захист від паралельної копії не втрачено** — гвард
  `syncInFlight` працює як і раніше, тож повторний клік показує тост
  «Синхронізація вже виконується», а не піднімає другу копію.
  Кнопка «Оновити» (`#refreshBtn`) лишається з `await syncFile()`, бо там
  потрібна гарантована актуальність даних.

---

## [Unreleased]

---

## [0.0.610] – 2026-09-27
Release focus: **Analytics tab polish & data integrity** — dynamic forecast countdown, garage slots monotonic constraints, 3-row battles header layout, prestige alert cleanup, sync_now.sh regex fix.

### Added
- WebUI: **Dynamic forecast period slider countdown** — selecting a period now persists a target end-date timestamp; on each load the remaining days are recomputed so the slider counts down daily (e.g. 11 → 10 tomorrow).
- WebUI: **Enforced non-negative (≥ 0) and monotonic non-decreasing constraints** for garage slots in `getGarageSnapshot()` — prevents visual regression when cached data fluctuates.
- Shell: `sync_now.sh` garage count regex fixed (3901 → 3911) and date deduplication pattern hardened.

### Changed
- WebUI: **Removed obsolete KPI metrics** "Net Profit" and "Average Result" from the Battles dashboard — simplified to Total battles + Winrate only.
- WebUI: **Restructured Analytics battles header** into 3 vertically stacked rows:
  - Row 1: Block title (left-aligned)
  - Row 2: Time period filter buttons (right-aligned)
  - Row 3: Period summary counter "Зафіксовано за період" (left-aligned)
- WebUI: **Prestige alert safe state** — duplicate checkmark removed; text shortened to single-line "Ліміт безпечний (є запас)" / "Cap safe (plenty of headroom)".

### Fixed
- WebUI: Garage slots monotonic floor now uses previous day's locked count as minimum, preventing false drops.
- WebUI: Prestige alert "safe" state no longer renders redundant checkmark; fits on one line without wrapping.
- Shell: `sync_now.sh` garage slot parsing regex corrected (3911 vs 3901) and deduplication logic stabilized.

---

## [0.0.605] – 2026-09-11
Release focus: **WebUI Analytics Refactor** — Prestige Cap Alert + unified Battles dashboard + dead-code cleanup.

### Added
- WebUI: Prestige **Cap Alert** Callout rendered above the prestige chart.
  `computePrestigeAlert()` — limit = 1000; tomorrow = current + dailyGain (7-day active-day window); states: `max` (≥1000), `overflow` (>1000, red), `near` (≥850, amber), `safe`.
- WebUI: horizontal dashed `y = 1000` limit line on the prestige sparkline
  (`renderSparkline(..., maxLine)` → `.an-chart-max-line`).
- WebUI: **unified Battles dashboard** — Header (title + Today / 3 Days / 7 Days / All filter) → Quick KPIs (Total battles / Wins-Losses winrate / Net profit / Avg result) → Split body (battle timeline | W/D/L breakdown).
- WebUI: responsive dashboard grid (4-col KPI grid → 2-col on ≤430 px; split → single column).
- WebUI: all new i18n keys for the prestige alert and battles dashboard (UKR + ENG),
  including the missing EN translations.

### Changed
- WebUI: replaced the stale "За поточним темпом до 1000 престижу залишилось…" text
  with the dynamic Prestige Cap Alert Callout.
- WebUI: `renderSparkline()` gained an optional `maxLine` parameter;
  `renderMetric()` gained optional `maxLine` + `preChartHtml` parameters.

### Removed
- WebUI: removed dead HTML blocks `#battleTile`, `#battleStatsInline` and children
  (`#battleBarBg`, `#battleBarText`, `#battleWins/Draws/Losses`) from the Analytics card.
- WebUI: removed dead `renderBattleBar()` function and its `loadGarageStats()` call.
- WebUI: removed unused i18n key `garage_battles` (UKR + ENG).

---

## [0.0.604] – 2026-09-10
### Fixed
- Corrected YAML indentation in `release.yml` so "Update update.json" and "Create Release" steps run in proper order.
- Restored the correct release workflow sequence with a rebase before push to avoid non-fast-forward failures on tag.

### Changed / Added
- Introduced **non-interactive mode** in `customize.sh` (`UNATTENDED=1`, `SKIP_DISCLAIMER=1`, or `! -t 0`).
- Removed blocking Volume-Key / keycheck / `choose_yn` pauses.
- GitHub Actions pushes `update.json` explicitly and computes its own SHA-256.

---

## [0.0.603] – 2026-09-10
### Fixed
- **Analytics Prestige forecast formula** — now based on **active daily gain** (7-day rolling window over days with positive deltas only), ignoring rest/no-play days. Gives ~5-7 days rather than an inflated 41.
- CI/CD: added **rebase before push** in `release.yml` to avoid non-fast-forward errors on tag push.

---

## [0.0.602] – 2026-09-10
### Changed
- **Battles** block moved from the **Garage** tab to **Analytics**, with dynamics: daily activity chart (Daily Δ mode), W/D/L counters, total battles.

### Added
- Daily `battleTotal` saved into the history snapshot (`history.jsonl`) for chart dynamics.
- i18n key `an_battles` (UKR + ENG).

---

## [0.0.601] – 2026-09-09
### Added
- "Support the dev" button integrated into the WebUI header.

### Fixed
- CI/CD build + GitHub Pages config (`.nojekyll`).
- General WebUI stability & performance.

---

## [0.0.600] – 2026-09-09
### Changed
- WebUI UI rendering performance (`requestAnimationFrame` for heavy blocks).
- Chart repaint smoothness in Analytics (60 FPS).
- Local storage stability; general WebUI cleanup.

---

## [0.0.527] – 2026-09-07
### Changed
- Heavy SVG chart building & DOM updates wrapped in `requestAnimationFrame` (60 FPS).
- `will-change: transform` on sparkline containers (mobile smoothness).

### Removed
- Unused cross-navigation UI elements; interface unchanged visually.

---

## [0.0.523] – 2026-09-07
### Added — Automatic Update Fix & Full Changelog
- **Automatic module update** — fixed background install blocking on interactive disclamer (Volume Keys). Added `SKIP_DISCLAIMER=1` / `UNATTENDED=1` non-interactive mode.
- **Full installer logging** — fixed stdout/stderr truncation; full log at
  `/data/local/tmp/td2tdr_install.log` with a copy button in the UI.
- **Non-blocking launch** — browser opens in ~300 ms on "Sync & open", without waiting for heavy background work.
- **Micro-statuses** — step-by-step progress ("Syncing files…" → "Checking status…" → "Done").
- **Sync robustness** — progressive back-off in `wait_stable()`, size check before fallback copy, `service.alive` heartbeat, PID-lock in `service.sh`.
- **Speed** — combined `ksu.exec` calls via `getCombinedStats()`, 3 s UI timeouts, `Promise.all()` parallelism.

---

## [0.0.516] – 2026-09-05
### Added
- Background auto-collection & history update on game save/close and on timer (`service.sh`).
- Patch I (empty-shot guard), Patch K (resource fallback parsers), Patch L (stale-copy guard).

### Changed
- `sync_now.sh` now parses Cash/Gold/Prestige + `garageTotal`/`garageLocked` and writes atomically to `history.jsonl` (primary + alt).
- `service.sh` periodic force-sync every 6 h even with no `mtime` change.
- Dedup by date — one row per day, overwritten on each sync.

### Fixed
- JS 3-tier regex fallback in `getResourceSnapshot` (Tier 1: `KEY=8hex,iN`; Tier 2: `KEY=Nhex,iN`; Tier 3: `KEY=iN`).
- JS warning in log if `user.dat` copy is >30 min old.

---

## [0.0.515] – 2026-09-05
### Changed (UI cleanup)
- Removed period text duplication in forecast; accent on the forecast date.
- Forecast card: single accent date header `DD.MM.YYYY` (no more "Forecast for N days" inside the card).
- Period indicator stays only next to the slider ("Forecast period: N days").
- Cleaned spare `meta-item` blocks & inner card borders.

### Removed
- Unused i18n keys `an_projection`, `an_forecast_period`.

---

## [0.0.514] – 2026-09-05
### Fixed — Atomic writes & validation
- `history.jsonl` atomic write (`tmp` + `mv -f`) — unexpected reboot no longer corrupts the file.
- Dedup by `date` before write — one canonical row per day.
- `loadHistory` validates every row (ISO date + `Number.isFinite` fields) — dirty files safely skipped.
- `TextEncoder` replaces deprecated `unescape(encodeURIComponent(...))` in base64.

---

## [0.0.513] – 2026-09-05
### Fixed
- Universal installer compatibility with KernelSU / APatch (fixed "magisk not found" error).
- WebUI now probes the root manager (`magisk` / `ksud` / `apd`) before install — no more "failed magisk → fallback".

---

## [0.0.512] – 2026-09-05
### Removed
- Analytics KPI dashboard (Net / Avg / Max / Day / Trend 7d) — UI simplification.
- "Песиміст / Оптиміст" forecast scenarios — only the base projected balance + `DD.MM.YYYY` date remain.
- Unused i18n keys (`an_period_7/30/all`, `an_kpi_*`, `an_forecast_scenarios/*`).

### Changed
- Guarded against negative projected balance: `Math.max(0, projected)`.
- Default chart mode: `cumulative` (when `localStorage` is empty).

---

## [0.0.511] – 2026-09-05
### Changed
- Full history on charts — forecast slider no longer repaints charts; only the forecast block updates (isolated `updateForecastBlock`).
- Removed "7д / 30д" chips — aggregated values now live in the KPI dashboard above the charts.
- Forecast block shows a date reference `DD.MM.YYYY` with a accent card.
- Chart mode toggle `[Cumulative | Daily Δ]` with zero line + tooltip (date, delta, balance).
- Forecast slider range: 1..90 days.

### Added
- Chart mode + forecast period persisted in `localStorage`.

---

## [0.0.510] – 2026-09-05
### Fixed
- Analytics Reset & Import modals now close on **Escape** (previously only ✕ + backdrop click).
- Forecast rate color fixed to green `#34d399` (doesn't blend with the sum in any theme).
- Negative rate shown 🔴 red; zero rate shown as "— / day" (no misleading "+0").
- `padding-bottom` on `.wrap` now accounts for `safe-area-inset-bottom` in portrait so the tab-bar doesn't cover the last cards on phones with a Home indicator.

### Added
- Import uses a specific error key `an_imp_error` with UK + EN translations.

---

## [0.0.509] – 2026-08-25
### Changed
- Removed the "Activity Summary" block and period switch — one reliable 14-day income calculation.
- Forecast color hierarchy: balance in resource color (Cash green, Gold amber, Prestige purple, Slots cyan); neutral label; rate in light green.
- Stats button reduced to a compact "N days" sticker.

### Added
- Modern semi-transparent modals (install / reset / import) with ✕ close button + backdrop click.

---

## [0.0.507] – 2026-08-25
### Changed
- "Clear" button replaced with an interactive stats sticker "Statistics: N days" (days since first snapshot).
- History reset now goes through a confirmation modal ("Reset analytics history" with start date + red "🗗 Reset data" button) — no instant deletion.
- Counter resets to "Statistics: 0 days" with charts + forecast refresh.

---

## [0.0.506] – 2026-08-25
### Changed (new forecast model)
- Forecast = linear accumulation of **net income**: `Forecast = Balance + Income/day × Days`. One-time past expenses no longer create a daily minus.
- Removed Net Rate, red highlights and "exhaustion" badges — forecast always shows growth from the current balance.
- 🛍️ "Expense: −X (date)" — reference indicator of the last write-off.
- Forecast card flow: Current balance → Forecast for N days → 🟢 profit rate +X / day.

---

## [0.0.505-beta] – 2026-08-25
### Fixed
- Log container no longer "leaks" onto other tabs — shown only in the active Journal tab, stretching to the tab-bar.

### Changed
- Forecast cards simplified: main number = projected balance, below it the net rate (+X/−Y per day); gross details in a tooltip row.
- Exhaustion timer uses the **net** rate (Income − Expenses): `Days_left = floor(Balance / |Net|)`; badge only when forecast period ≥ Days_left.

---

## [0.0.504-beta] – 2026-08-25
### Changed
- Daily gain computed only from **positive deltas** (net earnings); expenses shown separately and used for the exhaustion timer.
- Log window stretches to the bottom tab-bar (`calc(100vh)`), maximising useful area.

### Added
- "Download" button now actually installs the module — zip download, SHA-256 check, install via `magisk`/`ksud` with overlay progress.
- Metadata: concise "TD2TDR Sync" name + short description.

### Changed
- Full landscape adaptation — two-column Garage/Analytics, compact tab-bar, full-height Journal.

---

## [0.0.503-beta] – 2026-08-25
### Fixed
- Removed eternal loading — restored `history.jsonl` reading with `/data/media` fallback, full `try/catch`, error message instead of hang.

### Changed
- Journal: window height bumped (300 px+ / 58 vh), colored log levels (INFO cyan / WARN amber / ERR red / DEBUG grey), Journal tab blinks red on errors.
- Garage: removed donut — only the clean upgrade stack remains; cards fully minimal, no accent highlights.
- `td2tdr_sync`: locale/theme/ui_lang persisted in WebUI `localStorage`; config files deleted from the folder.

---

## [0.0.502-beta] – 2026-08-25
### Changed
- Correct negative forecast (`Balance + Delta × Days`, clamped to 0); "expires in N days" badge only when the forecast period reaches the zeroing point.
- "Peak spend day: -X (date)" shown next to peak gain; colored daily gain + risk zone for negative forecasts.
- Garage: minimal unified cards — no heavy gradients or inner glows.
- `td2tdr_sync`: locale/theme/ui_lang moved to WebUI `localStorage`; config files removed from folder (only `Garage.dat`, `user.dat`, `history.jsonl` remain).

---

## [0.0.501] – 2026-08-24
### Changed — Sync
- Instant load of the latest state from `localStorage` cache on WebUI open (no "Not loaded" + no awaiting shell).
- Removed background auto-queries on launch — re-read/copy only on "Sync & open" / "Refresh".
- Retry verification with pauses, FS cache sync, fallback copy to `/storage` on `/data/media` lock.
- Detailed logging of every copy step in `sync.log`.

### Changed — Garage
- Contrast card redesign: accent gradients + borders for "Upgrades" and "Battles".
- Compact circular donut for upgrade distribution.
- LED warning on slots when fill > 95%.
- Highlighted "Held" tag with tooltip.

### Changed — Analytics
- Period slider 3–90 days (replacing fixed buttons).
- Two-column compact forecast block with daily gain (+X / day).
- Forecast accuracy indicator (history depth).
- "Garage" metric counts occupied slots; "Peak day" instead of "best gain".

### Changed — Optimization
- Code cleanup, removed artifacts.
- Sticky green status state without false resets.
- `changelog.md` embedded in build + local fallback in "Version history" window.
- General stability + module size optimization.

---

## [0.0.305] – 2026-08-20
### Fixed — "NOT valid JSON" on Garage.dat pick
- Created a single `sync_now.sh` for background daemon + WebUI.
- Copy via direct path `/data/media/0/Download/td2tdr_sync` with `media_rw` rights (uid/gid 1023) and `media_rw_data_file` context — browser now reads the file reliably.
- Atomic write via `.part` with source-size stabilization (removes save-time race).
- MediaStore notification (`am broadcast / content scan`) for instant visibility in file manager.
- `modify` event removed from `inotifywait` (kept `close_write`, `create`, `moved_to`).
- Fixed `chmod` crash in WebUI when `user.dat` absent.

> `v0.0.305` was a silent release; the changelog is backfilled from git history. Earlier
> versions (0.0.302–0.0.304, 0.0.501-preview) are omitted for brevity — they live in
> git history / the GitHub "Version history" window.

[Unreleased]: https://keepachangelog.com/
[0.0.605]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.605
[0.0.604]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.604
[0.0.603]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.603
[0.0.602]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.602
[0.0.601]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.601
[0.0.600]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.600
[0.0.527]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.527
[0.0.523]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.523
[0.0.516]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.516
[0.0.515]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.515
[0.0.514]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.514
[0.0.513]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.513
[0.0.512]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.512
[0.0.511]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.511
[0.0.510]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.510
[0.0.509]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.509
[0.0.507]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.507
[0.0.506]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.506
[0.0.505]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.505
[0.0.504]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.504
[0.0.503]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.503
[0.0.502]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.502
[0.0.501]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.501
[0.0.305]: https://github.com/sansej8989/td2tdr/releases/tag/v0.0.305