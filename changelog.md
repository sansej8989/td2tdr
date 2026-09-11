# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release dates are derived from git tags. Entries below `## [Unreleased]` are
not yet packaged; move them under a tagged version once a release is cut.

---

## [Unreleased]

### Added
- CI/CD: GitHub Actions release workflow (`release.yml`) now uses `softprops/action-gh-release@v2`,
  computes the real **SHA-256** checksum of the release archive and writes it back to
  `update.json` via the GitHub API (no more placeholder hashes).
- CI/CD: non-interactive installer mode in `customize.sh` (flags `UNATTENDED=1`,
  `SKIP_DISCLAIMER=1`, or `! -t 0`) so installs launched from WebUI / Magisk Manager
  no longer block on Volume-Key prompts.
- WebUI: Prestige **cap alert** — a smart Callout rendered directly above the prestige
  sparkline. `computePrestigeAlert()` evaluates `current >= 850` and
  `projectedTomorrow = current + dailyGain` (7-day active-day window) and emits four
  states: `max`, `overflow` (red, shows estimated lost points), `near` (amber),
  `safe`.
- WebUI: horizontal dashed limit line at `y = 1000` on the prestige chart
  (`renderSparkline(..., maxLine)` → `.an-chart-max-line` CSS class).
- WebUI: **unified Battles dashboard** (`an-battles-dashboard`) — a single card with
  Header (title + Today / 3-Days / 7-Days / All quick filter) → Quick KPIs
  (Total battles / Win-Loss with winrate color indicator / Net profit / Avg result) →
  Split body (battle activity timeline | W/D/L breakdown stacked bar + legend).
- WebUI: all new i18n keys for the prestige alert and battles dashboard (UKR + ENG).
- WebUI: `will-change: transform` on sparkline containers for smoother mobile scroll.

### Changed
- WebUI: replaced the stale "За поточним темпом до 1000 престижу залишилось…" forecast
  text with the dynamic Prestige Cap Alert Callout above the chart.
- WebUI: `renderSparkline()` gained an optional `maxLine` parameter; `renderMetric()`
  gained optional `maxLine` + `preChartHtml` parameters so the alert renders inline
  above any metric chart.
- WebUI: Prestige forecast is now rendered by the alert system;
  `renderPrestigeForecastHtml()` is kept as an isolated block independent of the
  period slider (charts no longer repaint when the slider moves).
- Analytics: Prestige forecast formula now uses **active daily gain** (7-day rolling
  window over days with positive deltas only), ignoring rest/no-play days.
- Analytics: chart modes toggle stays only next to its chart; cumulative is the
  default when `localStorage` is empty.
- Garage: Battles scale tile moved from the Garage tab to the Analytics tab with
  dynamics (daily Δ mode, W/D/L counters).

### Removed
- WebUI: removed dead HTML blocks `#battleTile`, `#battleStatsInline` and their
  children (`#battleBarBg`, `#battleBarText`, `#battleWins/Draws/Losses`) from the
  Analytics card — superseded by the unified Battles dashboard.
- WebUI: removed the dead `renderBattleBar()` function and its `loadGarageStats()`
  call (DOM targets no longer exist).
- WebUI: removed unused i18n key `garage_battles` (UKR + ENG).
- WebUI: removed KPI dashboard (Net / Avg / Max / Trend) and the
  "Песиміст / Оптиміст" forecast scenarios; removed unused keys
  `an_period_*`, `an_kpi_*`, `an_forecast_scenarios/*`.
- WebUI: removed the legacy Garage donut diagram — left only the clean upgrade
  stack distribution.

### Fixed
- CI/CD: repaired `release.yml` indentation so the "Update update.json" and
  "Create Release" steps are no longer accidentally skipped (the non-fast-forward
  push failure is now avoided via a `rebase` before push).
- CI/CD: GitHub Actions now pushes the `update.json` commit explicitly to `master`
  on tag push and uses `git fetch --tags` + retry loop to dodge replication lag.
- CI/CD: SHA-256 is now computed by CI itself (`sha256sum`) instead of being
  hard-coded, eliminating the mismatch seen in earlier releases.
- Analytics: protected against negative projected balance via `Math.max(0, projected)`.
- WebUI: `getGarageSnapshot()` now computes W/D/L as separate
  `battleWins`/`battleDraws`/`battleLosses` totals (not just a sum).
- WebUI: installer log truncation fixed; full stdout/stderr captured to
  `/data/local/tmp/td2tdr_install.log` with a copy button in the UI.
- Shell: atomic `history.jsonl` writes (`tmp` + `mv -f`) survive unexpected reboots;
  daily dedup keeps one canonical row per date; dirty rows are silently skipped.

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