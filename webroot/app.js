(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const MODDIR = "/data/adb/modules/td2tdr_sync";
  const SRC = "/storage/emulated/0/Android/data/com.hutchgames.cccg/files/Garage.dat";
  const SRC_USER = "/storage/emulated/0/Android/data/com.hutchgames.cccg/files/user.dat";
  // Fallback, якщо /storage/emulated/0 заблокований Scoped Storage:
  // raw-шлях до того самого файлу через /data/media (доступний з root).
  const SRC_ROOT = "/data/media/0/Android/data/com.hutchgames.cccg/files/Garage.dat";
  const SRC_USER_ROOT = "/data/media/0/Android/data/com.hutchgames.cccg/files/user.dat";
  const DST_DIR = "/storage/emulated/0/Download/td2tdr_sync";
  const DST = `${DST_DIR}/Garage.dat`;
  const DST_USER = `${DST_DIR}/user.dat`;
  const LOG = `${MODDIR}/sync.log`;
  // Persistent user data lives in DST_DIR (/sdcard), NOT in MODDIR — MODDIR
  // gets fully replaced by every module update/reflash, which used to wipe
  // history.jsonl (and reset the language/theme prefs) each time.
  const LANG_FILE = `${DST_DIR}/locale`;
  const THEME_FILE = `${DST_DIR}/theme`;
  const HISTORY_FILE = `${DST_DIR}/history.jsonl`;
  const UI_LANG_FILE = `${DST_DIR}/ui_lang`;
  // Raw-дзеркала персистентної теки через /data/media. У частині ROM /
  // SELinux-політик shell усередині WebUI не може читати FUSE-вид
  // /storage/emulated/0 (файл фізично є, але stat/cat повертають помилку),
  // тому кожен доступ робимо з фолбеком на /data/media/0 шлях.
  const DST_DIR_ALT = "/data/media/0/Download/td2tdr_sync";
  const DST_ALT = `${DST_DIR_ALT}/Garage.dat`;
  const DST_USER_ALT = `${DST_DIR_ALT}/user.dat`;
  const altPath = (p) => p.replace(DST_DIR, DST_DIR_ALT);

  // ---- helpers: конфіги UI у localStorage --------------------------------
  // У папці td2tdr_sync мають лишатися ТІЛЬКИ Garage.dat/user.dat/history.jsonl.
  // locale/theme/ui_lang зберігаємо в LS; старі файл-конфіги мігруємо один
  // раз і видаляємо з обох дзеркал теки.
  const CFG_KEYS = {
    ui_lang: "td2tdr_ui_lang",
    theme: "td2tdr_theme",
    game_locale: "td2tdr_game_locale",
  };
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  // Сучасне закриття динамічних модалок: кнопка ✕ у кутку картки +
  // клік по затемненому фону (overlay) + клавіша Escape. Без виходу з модуля.
  function wireModalClose(overlay) {
    const card = overlay.querySelector(".install-card");
    if (card && !card.querySelector(".overlay-x")) {
      const x = document.createElement("button");
      x.className = "overlay-x";
      x.setAttribute("aria-label", "close");
      x.textContent = "✕";
      card.appendChild(x);
      x.addEventListener("click", () => overlay.remove());
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    // v0.0.510: Escape закриває динамічну модалку (раніше працював лише
    // для статичних .modal-overlay). Одноразовий слухач, що автоматично
    // знімається після закриття — без витоку пам'яті.
    const onKey = (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
      }
    };
    document.addEventListener("keydown", onKey, true);
  }
  async function migrateAndRemoveCfg(file, key) {
    if (!hasKsu()) return;
    if (!lsGet(key)) {
      const r = await exec(`cat ${shellQuote(file)} 2>/dev/null`);
      if (r.errno === 0 && r.stdout.trim()) lsSet(key, r.stdout.trim());
    }
    // Видаляємо дрібний файл-конфіг з обох дзеркал теки
    await exec(`rm -f ${shellQuote(file)} ${shellQuote(altPath(file))}`).catch(() => {});
  }

  // ---- ksu bridge -----------------------------------------------------
  let seq = 0;
  function cbName(prefix) {
    return `${prefix}_callback_${Date.now()}_${seq++}`;
  }

  function hasKsu() {
    return typeof window.ksu !== "undefined" && typeof ksu.exec === "function";
  }

  function exec(cmd) {
    return new Promise((resolve) => {
      if (!hasKsu()) {
        // Demo/browser-preview mode. Resolving (not rejecting) here means
        // every existing "if (errno !== 0)" check across the codebase
        // handles this the same way it handles any other command failure —
        // no caller needs its own try/catch just to survive this case.
        // (Previously this rejected, and several call sites had no
        // try/catch around their `await exec(...)`, so a demo-mode click
        // would throw uncaught and permanently strand that button in its
        // disabled/spinning state — see syncFile()/openUrl()/saveLocale().)
        resolve({ errno: -1, stdout: "", stderr: "ksu bridge unavailable (demo mode)" });
        return;
      }
      const cb = cbName("exec");
      window[cb] = (errno, stdout, stderr) => {
        resolve({ errno: Number(errno), stdout: stdout || "", stderr: stderr || "" });
        delete window[cb];
      };
      try {
        ksu.exec(cmd, JSON.stringify({}), cb);
      } catch (err) {
        delete window[cb];
        resolve({ errno: -1, stdout: "", stderr: String(err && err.message || err) });
      }
    });
  }

  function toast(msg) {
    try { if (hasKsu() && typeof ksu.toast === "function") ksu.toast(msg); } catch (e) {}
  }

  // Ensures DST_DIR exists before any read/write to the persistent files that
  // live there (history/locale/theme/ui_lang). syncFile() also creates it,
  // but that may run later than these — this makes the order irrelevant.
  let dataDirReady = null;
  function ensureDataDir() {
    if (!dataDirReady) {
      dataDirReady = hasKsu()
        ? Promise.all([
            exec(`mkdir -p ${shellQuote(DST_DIR)}`).catch(() => {}),
            exec(`mkdir -p ${shellQuote(DST_DIR_ALT)}`).catch(() => {}),
          ])
        : Promise.resolve();
    }
    return dataDirReady;
  }

  // state: "ok" | "warn" | "bad" | null (null/omitted hides the dot)
  function setTabIndicator(tab, state) {
    const el = document.querySelector(`[data-tab-indicator="${tab}"]`);
    if (!el) return;
    el.classList.remove("ok", "warn", "bad");
    if (state) el.classList.add(state);
  }

  function shellQuote(str) {
    return `'${String(str).replace(/'/g, `'\\''`)}'`;
  }

  // ---- i18n (UI language: auto / uk / en) --------------------------------
  const I18N = {
    uk: {
      head_sub: "Garage Sync — ручне оновлення, локальні дані",
      status_label: "Статус синхронізації",
      status_no_ksu: "Немає доступу до ksu (відкрийте через менеджер)",
      status_no_access: "Немає доступу",
      status_demo_mode: "Демо-режим браузера (ПК)",
      flow_demo_size: "Демо · {size}",
      status_dash: "—",
      unit_b: "Б",
      unit_kb: "КБ",
      unit_mb: "МБ",
      unit_gb: "ГБ",
      flow_src: "Джерело",
      flow_dst: "Копія",
      flow_result: "Результат",
      flow_checking: "Перевірка…",
      flow_found: "Є",
      flow_not_found_src: "Не знайдено",
      flow_not_found_dst: "Немає",
      flow_in_sync: "Синхрон.",
      flow_diff: "Відрізн.",
      flow_need: "Потрібно",
      status_synced: "🟢 Готово · Garage.dat · {size}",
      status_size_mismatch: "🟡 Копія застаріла — джерело {src}, копія {dst}",
      status_no_garage: "🔴 Garage.dat гри не знайдено — гра ще не запускалась, не встановлена, або модуль не має доступу до її файлів",
      tt_changelog: "Реліз / Changelog",
      tt_settings: "Налаштування",
      tt_refresh: "Оновити",
      tt_status_details: "Натисніть, щоб побачити деталі",
      tt_save_apply: "Зберегти та застосувати",
      tt_diagnose: "Показати ключі мови в shared_prefs",
      tt_log_filter: "Фільтр рівнів",
      tt_log_clear: "Очистити консоль",
      log_filter_all: "Усі",
      status_no_copy: "🟡 Копії ще немає — натисніть «Синхронізувати та відкрити»",
      last_sync_label: "Остання синхронізація:",
      tab_sync: "Синхр.",
      tab_lang: "Мова",
      tab_garage: "Гараж",
      tab_log: "Журнал",
      tab_changelog: "Реліз",
      tab_analytics: "Аналіт.",
      sync_title: "Синхронізація та відкриття",
      sync_hint: "Скопіює Garage.dat і відкриє topdrivesrecords.com у системному браузері",
      lbl_open: "СИНХРОНІЗУВАТИ ТА ВІДКРИТИ",
      lbl_sync: "СИНХРОНІЗУВАТИ",
      lbl_done: "✓ ГОТОВО",
      lang_title: "Мова гри",
      lang_system: "Системна мова",
      lang_hint: "Оберіть мову зі списку та натисніть дискету — гра перезапуститься автоматично",
      res_title: "Ресурси",
      res_empty: "Синхронізуйте файли, щоб побачити ресурси",
      res_prestige: "Престиж",
      garage_title: "Статистика",
      garage_calc_btn: "Порахувати",
      garage_analyzing: "Аналіз…",
      garage_empty: "Синхронізуйте гру — гараж проаналізується автоматично",
      garage_slots: "слотів у гаражі",
      garage_fill: "Гараж",
      garage_upgrade: "Прокачка",
      garage_total_cars: "авто в гаражі",
      garage_battles: "Бої",
      garage_held: "Held: {held} — для прокачки або продажу",
      garage_held_short: "Held: {held}",
      upg_custom: "Інше",
      battle_wins: "Перемоги",
      battle_draws: "Нічиї",
      battle_losses: "Програші",
      log_title: "Журнал",
      log_empty: "Немає даних",
      log_save: "Зберегти",
      log_send: "Відправити",
      cl_title: "Історія версій",
      cl_loading: "Завантаження…",
      cl_current: "ПОТОЧНА",
      cl_archive: "АРХІВ",
      cl_load_error: "Не вдалося завантажити changelog.md",
      log_code: "код {code}",
      log_sync_error: "Помилка синхронізації: {reason}",
      log_synced_manual: "Файли синхронізовано вручну через WebUI",
      log_open_link_failed: "Не вдалося відкрити посилання: {reason}",
      log_sync_unavailable_demo: "Синхронізація недоступна в демо-режимі браузера (немає root-доступу)",
      log_open_unavailable_demo: "Відкриття браузера недоступне в демо-режимі (немає root-доступу)",
      toast_open_link_failed: "Не вдалося відкрити посилання",
      log_locale_set: "Мова: {locale}",
      log_locale_system: "системна",
      log_cmd_locale_error: "cmd locale помилка: {reason}",
      log_per_app_locale_applied: "Per-app locale застосовано (перевірка: {check})",
      log_set_locale_sh_error: "set_locale.sh помилка: {reason}",
      log_set_locale_sh_done: "set_locale.sh: {summary}",
      log_locale_unconfirmed: "Гру перезапущено, але жоден механізм зміни мови не підтвердив успіх — перевірте журнал вище",
      toast_locale_applied: "Мову змінено",
      toast_locale_unconfirmed: "Гру перезапущено, але зміна мови не підтверджена — див. журнал",
      toast_sync_failed: "Помилка синхронізації — див. журнал",
      btn_wait_sync: "Зачекайте: виконується первинна синхронізація…",
      toast_not_ready: "Файл ще не готовий — повторіть за мить",
      log_auto_resync: "Кнопку натиснуто до готовності копії — виконую аварійну синхронізацію…",
      log_copy_ok: "Копіювання у Download: УСПІХ ({size})",
      log_copy_fail: "Копіювання у Download: ПОМИЛКА — файл не створено (див. sync.log)",
      status_ready_sticky: "Готово — копія підтверджена раніше",
      log_stopping_game: "Зупиняю гру…",
      log_starting_game: "Запускаю гру…",
      log_game_started: "Гру запущено",
      log_game_start_failed: "Помилка запуску гри",
      toast_game_start_failed: "Не вдалося запустити гру",
      log_diag_start: "=== ДІАГНОСТИКА МОВИ ===",
      log_diag_path: "Шлях: {path}",
      log_diag_no_prefs: "shared_prefs XML не знайдено",
      log_diag_file: "--- Файл: {file} ---",
      log_diag_no_entries: "  (немає <string> записів)",
      log_diag_end: "=== КІНЕЦЬ ДІАГНОСТИКИ ===",
      log_garage_not_found: "Гараж: файл гри не знайдено ({path})",
      toast_garage_not_found: "Garage.dat гри не знайдено — переконайтеся, що гра запускалась",
      log_garage_no_playerdeck: "Гараж: рядок PlayerDeck не знайдено у файлі",
      log_garage_parse_failed: "Гараж: не вдалося розібрати PlayerDeck",
      log_garage_analyzed: "Гараж проаналізовано: {total} авто ({locked} locked, {held} held)",
      log_garage_analyze_error: "Помилка аналізу гаража: {message}",
      log_analytics_snapshot_error: "Аналітика: помилка запису знімка ({message})",
      log_js_error: "ПОМИЛКА: {message}",
      log_js_unhandled: "НЕОБРОБЛЕНА ПОМИЛКА: {reason}",
      toast_synced: "Синхронізовано",
      toast_log_saved: "Журнал збережено: {path}",
      log_log_saved: "Журнал збережено в {path}",
      prompt_log_endpoint: "Введіть URL серверу для відправки журналу:",
      alert_log_sent: "Журнал успішно відправлено",
      alert_log_send_failed: "Не вдалося відправити журнал: {message}",
      toast_path_fixed: "Наразі шлях фіксований модулем; налаштування лише для довідки",
      log_console_cleared: "Консоль очищено",
      log_analytics_history_cleared: "Історію аналітики очищено",
      log_resources_loaded: "Ресурси завантажено з user.dat",
      res_prestige_overflow_warn: "Очки престижу скоро згорять від переповнення — витратьте їх",
      sm_title: "Синхронізація",
      sm_hint: "У браузері торкніться поля вибору файлу — Garage.dat вже лежить у Download/td2tdr_sync",
      sm_step_copy: "Копіюю Garage.dat з ігрової теки",
      sm_step_copy_done: "Файл скопійовано",
      sm_step_copy_fail: "Не вдалося скопіювати файл",
      sm_step_copy_unverified: "Скрипт завершився без помилок, але файл не знайдено на диску",
      log_sync_verified: "Копію перевірено фізично: {size} на диску",
      log_sync_unverified: "Скрипт синхронізації повідомив про успіх, але файл не знайдено за шляхом {path} — можлива розбіжність шляхів",
      tt_close: "Закрити",
      sm_step_check: "Перевіряю статус синхронізації",
      sm_step_check_done: "Статус перевірено",
      sm_step_open: "Відкриваю topdrivesrecords.com",
      sm_step_open_done: "Сайт відкрито",
      sm_step_open_fail: "Не вдалося відкрити браузер",
      upd_installed: "Встановлено: v{version}",
      upd_checking: "Перевірка оновлень…",
      upd_latest: "Встановлена остання версія",
      upd_available: "Доступне оновлення",
      upd_open: "Завантажити",
      upd_unavailable: "Перевірка оновлень недоступна",
      cl_empty: "Порожній changelog",
      an_title: "Динаміка",
      an_clear: "Очистити",
      an_hint: "Знімок стану записується автоматично раз на добу — при відкритті WebUI, якщо дані вже синхронізовані",
      an_no_access: "Недоступно без root-доступу",
      an_no_data: "Дані ще не зібрані. Синхронізуйте гру хоча б раз — знімок запишеться автоматично.",
      an_not_enough: "Замало даних — потрібно 2+ дні спостережень",
      an_days_collected: "Зібрано {have} з {need} днів",
      an_first_point: "Перший знімок: {value}",
      an_cash: "Cash",
      an_gold: "Gold",
      an_prestige: "Престиж",
      an_garage: "Гараж (слотів)",
      an_delta_24h: "/ 24г",
      an_record_gain: "Піковий день: <b>+{value}</b> ({date})",
      an_record_loss: "Витрата: <b>-{value}</b> ({date})",
      an_depletes_in: "вичерпається за {days} дн.",
      an_spend: "витрати",
      an_load_error: "Не вдалося завантажити аналітику — перевірте Журнал",
      an_stat_days: "{n} дн.",
      an_reset_title: "Скидання історії аналітики",
      an_reset_text: "Статистика збирається вже {n} дн. (з {date}). Ви дійсно бажаєте видалити всі збережені знімки історії ресурсів?",
      an_reset_confirm: "🗑️ Скинути дані",
      an_cancel: "Скасувати",
      an_export: "Експорт",
      an_import: "Імпорт",
      an_imp_found: "Знайдено {n} записів. Об'єднати з поточною історією чи перезаписати?",
      an_imp_merge: "Об'єднати",
      an_imp_overwrite: "Перезаписати",
      an_imp_done: "Імпортовано: історія містить {n} записів",
      an_imp_error: "Не вдалося імпортувати: пошкоджений або невалідний файл",
      upd_installing: "Завантаження оновлення...",
      upd_dl: "Завантаження архіву оновлення…",
      upd_verify: "Перевірка SHA-256…",
      upd_installing_module: "Встановлення модуля…",
      upd_done: "Готово!",
      upd_done_reboot: "Оновлення встановлено — перезавантажте пристрій",
      upd_done_short: "Встановлено ✓",
      an_accuracy: "Точність прогнозу: {pct}%",
      an_projection: "Прогноз на {days} дн.:",
      an_per_day: " / день",
      an_range_title: "Прогнозний період",
      an_forecast_conf_label_low: "точність: низька",
      an_forecast_conf_label_med: "точність: середня",
      an_forecast_conf_label_high: "точність: висока",
      an_forecast_max: "🏆 Престиж вже на максимумі (1000) — не забудьте його витратити.",
      an_forecast_days: "📈 За поточним темпом до <b>1000 престижу</b> залишилось приблизно <b>{days} дн.</b> Це груба оцінка на основі останніх днів, не гарантія.",
      an_forecast_flat: "📉 Темп зростання престижу зараз не додатний — прогноз побудувати не вдалося.",
      an_mode_daily: "Денні зміни",
      an_mode_cumulative: "Накопичувальний",
      an_forecast_period: "Прогнозний період",
      an_forecast_date: "Дата прогнозу",
      an_tooltip_date: "Дата",
      an_tooltip_delta: "Зміна за день",
      an_tooltip_balance: "Баланс на день",
      settings_title: "Налаштування",
      settings_theme: "Тема",
      theme_auto: "Авто",
      theme_light: "Світла",
      theme_dark: "Темна",
      theme_amoled: "AMOLED",
      settings_ui_lang: "Мова інтерфейсу",
      ui_lang_auto: "Авто",
      ui_lang_uk: "UKR",
      ui_lang_en: "ENG",
      settings_src_path: "Шлях джерела",
      settings_dst_path: "Шлях копії",
      settings_not_selected: "Не вибрано",
      settings_paths_fixed_note: "Шляхи фіксовані модулем і не редагуються — показані для довідки",
      settings_default: "За замовч.",
      settings_save: "Зберегти",
      settings_close: "Закрити",
    },
    en: {
      head_sub: "Garage Sync — manual update, local data",
      status_label: "Sync status",
      status_no_ksu: "No ksu access (open via the manager app)",
      status_no_access: "No access",
      status_demo_mode: "Browser demo mode (PC)",
      flow_demo_size: "Demo · {size}",
      status_dash: "—",
      unit_b: "B",
      unit_kb: "KB",
      unit_mb: "MB",
      unit_gb: "GB",
      flow_src: "Source",
      flow_dst: "Copy",
      flow_result: "Result",
      flow_checking: "Checking…",
      flow_found: "Found",
      flow_not_found_src: "Not found",
      flow_not_found_dst: "None",
      flow_in_sync: "In sync",
      flow_diff: "Differs",
      flow_need: "Needed",
      status_synced: "🟢 Ready · Garage.dat · {size}",
      status_size_mismatch: "🟡 Copy is stale — source {src}, copy {dst}",
      status_no_garage: "🔴 Game's Garage.dat not found — the game hasn't been launched yet, isn't installed, or the module doesn't have access to its files",
      tt_changelog: "Release / Changelog",
      tt_settings: "Settings",
      tt_refresh: "Refresh",
      tt_status_details: "Tap to see details",
      tt_save_apply: "Save and apply",
      tt_diagnose: "Show language keys in shared_prefs",
      tt_log_filter: "Level filter",
      tt_log_clear: "Clear console",
      log_filter_all: "All",
      status_no_copy: "🟡 No copy yet — tap “Sync & open”",
      last_sync_label: "Last sync:",
      tab_sync: "Sync",
      tab_lang: "Lang",
      tab_garage: "Garage",
      tab_log: "Log",
      tab_changelog: "Release",
      tab_analytics: "Stats",
      sync_title: "Sync & open",
      sync_hint: "Copies Garage.dat and opens topdrivesrecords.com in the system browser",
      lbl_open: "SYNC & OPEN",
      lbl_sync: "SYNC",
      lbl_done: "✓ DONE",
      lang_title: "Game language",
      lang_system: "System language",
      lang_hint: "Pick a language and tap the save icon — the game restarts automatically",
      res_title: "Resources",
      res_empty: "Sync the files to see resources",
      res_prestige: "Prestige",
      garage_title: "Statistics",
      garage_calc_btn: "Calculate",
      garage_analyzing: "Analyzing…",
      garage_empty: "Sync the game — the garage will be analyzed automatically",
      garage_slots: "garage slots",
      garage_fill: "Garage",
      garage_upgrade: "Upgrades",
      garage_total_cars: "cars in garage",
      garage_battles: "Battles",
      garage_held: "Held: {held} — for upgrading or selling",
      garage_held_short: "Held: {held}",
      upg_custom: "Other",
      battle_wins: "Wins",
      battle_draws: "Draws",
      battle_losses: "Losses",
      log_title: "Log",
      log_empty: "No data",
      log_save: "Save",
      log_send: "Send",
      cl_title: "Version history",
      cl_loading: "Loading…",
      cl_current: "CURRENT",
      cl_archive: "ARCHIVE",
      cl_load_error: "Couldn't load changelog.md",
      log_code: "code {code}",
      log_sync_error: "Sync error: {reason}",
      log_synced_manual: "Files synced manually via WebUI",
      log_open_link_failed: "Couldn't open the link: {reason}",
      log_sync_unavailable_demo: "Sync isn't available in browser demo mode (no root access)",
      log_open_unavailable_demo: "Opening the browser isn't available in demo mode (no root access)",
      toast_open_link_failed: "Couldn't open the link",
      log_locale_set: "Language: {locale}",
      log_locale_system: "system",
      log_cmd_locale_error: "cmd locale error: {reason}",
      log_per_app_locale_applied: "Per-app locale applied (check: {check})",
      log_set_locale_sh_error: "set_locale.sh error: {reason}",
      log_set_locale_sh_done: "set_locale.sh: {summary}",
      log_locale_unconfirmed: "Game restarted, but no locale mechanism confirmed success — check the log above",
      toast_locale_applied: "Language changed",
      toast_locale_unconfirmed: "Game restarted, but the language change wasn't confirmed — see log",
      toast_sync_failed: "Sync failed — see the log",
      btn_wait_sync: "Please wait: initial sync in progress…",
      toast_not_ready: "File not ready yet — try again shortly",
      log_auto_resync: "Button pressed before copy was ready — running emergency sync…",
      log_copy_ok: "Copy to Download: SUCCESS ({size})",
      log_copy_fail: "Copy to Download: FAILED — file was not created (see sync.log)",
      status_ready_sticky: "Ready — copy confirmed earlier",
      log_stopping_game: "Stopping the game…",
      log_starting_game: "Starting the game…",
      log_game_started: "Game started",
      log_game_start_failed: "Failed to start the game",
      toast_game_start_failed: "Couldn't start the game",
      log_diag_start: "=== LANGUAGE DIAGNOSTICS ===",
      log_diag_path: "Path: {path}",
      log_diag_no_prefs: "shared_prefs XML not found",
      log_diag_file: "--- File: {file} ---",
      log_diag_no_entries: "  (no <string> entries)",
      log_diag_end: "=== END OF DIAGNOSTICS ===",
      log_garage_not_found: "Garage: game file not found ({path})",
      toast_garage_not_found: "Game's Garage.dat not found — make sure the game has been launched",
      log_garage_no_playerdeck: "Garage: PlayerDeck line not found in the file",
      log_garage_parse_failed: "Garage: couldn't parse PlayerDeck",
      log_garage_analyzed: "Garage analyzed: {total} cars ({locked} locked, {held} held)",
      log_garage_analyze_error: "Garage analysis error: {message}",
      log_analytics_snapshot_error: "Analytics: snapshot write error ({message})",
      log_js_error: "ERROR: {message}",
      log_js_unhandled: "UNHANDLED ERROR: {reason}",
      toast_synced: "Synced",
      toast_log_saved: "Log saved: {path}",
      log_log_saved: "Log saved to {path}",
      prompt_log_endpoint: "Enter the server URL to send the log to:",
      alert_log_sent: "Log sent successfully",
      alert_log_send_failed: "Couldn't send the log: {message}",
      toast_path_fixed: "The path is fixed by the module for now; this setting is for reference only",
      log_console_cleared: "Console cleared",
      log_analytics_history_cleared: "Analytics history cleared",
      log_resources_loaded: "Resources loaded from user.dat",
      res_prestige_overflow_warn: "Prestige points will soon overflow and be lost — spend them",
      sm_title: "Syncing",
      sm_hint: "In the browser, tap the file field — Garage.dat is already in Download/td2tdr_sync",
      sm_step_copy: "Copying Garage.dat from the game folder",
      sm_step_copy_done: "File copied",
      sm_step_copy_fail: "Couldn't copy the file",
      sm_step_copy_unverified: "The script finished without errors, but the file wasn't found on disk",
      log_sync_verified: "Copy physically verified: {size} on disk",
      log_sync_unverified: "The sync script reported success, but no file was found at {path} — possible path mismatch",
      tt_close: "Close",
      sm_step_check: "Checking sync status",
      sm_step_check_done: "Status checked",
      sm_step_open: "Opening topdrivesrecords.com",
      sm_step_open_done: "Site opened",
      sm_step_open_fail: "Couldn't open the browser",
      upd_installed: "Installed: v{version}",
      upd_checking: "Checking for updates…",
      upd_latest: "You're on the latest version",
      upd_available: "Update available",
      upd_open: "Download",
      upd_unavailable: "Update check unavailable",
      cl_empty: "Changelog is empty",
      an_title: "Trends",
      an_clear: "Clear",
      an_hint: "A daily snapshot is recorded automatically when you open the WebUI, if data is already synced",
      an_no_access: "Unavailable without root access",
      an_no_data: "No data yet. Sync the game at least once — a snapshot will be recorded automatically.",
      an_not_enough: "Not enough data yet — need 2+ days of history",
      an_days_collected: "Collected {have} of {need} days",
      an_first_point: "First snapshot: {value}",
      an_cash: "Cash",
      an_gold: "Gold",
      an_prestige: "Prestige",
      an_garage: "Garage (slots)",
      an_delta_24h: "/ 24h",
      an_record_gain: "Best day: <b>+{value}</b> ({date})",
      an_record_loss: "Last spend: <b>-{value}</b> ({date})",
      an_depletes_in: "runs out in {days} days",
      an_spend: "spend",
      an_load_error: "Failed to load analytics — check the Log",
      an_stat_days: "{n} d",
      an_reset_title: "Reset analytics history",
      an_reset_text: "Statistics has been collected for {n} days (since {date}). Do you really want to delete all saved resource snapshots?",
      an_reset_confirm: "🗑️ Reset data",
      an_cancel: "Cancel",
      an_export: "Export",
      an_import: "Import",
      an_imp_found: "Found {n} records. Merge with current history or overwrite?",
      an_imp_merge: "Merge",
      an_imp_overwrite: "Overwrite",
      an_imp_done: "Imported: history now has {n} records",
      an_imp_error: "Import failed: corrupted or invalid file",
      upd_installing: "Downloading update...",
      upd_dl: "Downloading update archive…",
      upd_verify: "Verifying SHA-256…",
      upd_installing_module: "Installing module…",
      upd_done: "Done!",
      upd_done_reboot: "Update installed — reboot your device",
      upd_done_short: "Installed ✓",
      an_accuracy: "Forecast accuracy: {pct}%",
      an_projection: "{days}-day projection:",
      an_per_day: " / day",
      an_range_title: "Forecast period",
      an_forecast_conf_label_low: "confidence: low",
      an_forecast_conf_label_med: "confidence: medium",
      an_forecast_conf_label_high: "confidence: high",
      an_forecast_max: "🏆 Prestige is already maxed (1000) — don't forget to spend it.",
      an_forecast_days: "📈 At the current pace, reaching <b>1000 prestige</b> will take roughly <b>{days} days</b>. This is a rough estimate, not a guarantee.",
      an_forecast_flat: "📉 Prestige isn't trending upward right now — couldn't build a forecast.",
      an_mode_daily: "Daily Δ",
      an_mode_cumulative: "Cumulative",
      an_forecast_period: "Forecast period",
      an_forecast_date: "Forecast date",
      an_tooltip_date: "Date",
      an_tooltip_delta: "Daily Δ",
      an_tooltip_balance: "Balance",
      settings_title: "Settings",
      settings_theme: "Theme",
      theme_auto: "Auto",
      theme_light: "Light",
      theme_dark: "Dark",
      theme_amoled: "AMOLED",
      settings_ui_lang: "Interface language",
      ui_lang_auto: "Auto",
      ui_lang_uk: "UKR",
      ui_lang_en: "ENG",
      settings_src_path: "Source path",
      settings_dst_path: "Copy path",
      settings_not_selected: "Not selected",
      settings_paths_fixed_note: "Paths are fixed by the module and can't be edited — shown for reference only",
      settings_default: "Default",
      settings_save: "Save",
      settings_close: "Close",
    },
  };

  let currentUiLang = "uk";

  // ---- i18n debug mode: OFF by default, never visible to normal users ----
  // console.warn never touches the UI on its own, so those warnings are
  // always-on and free. The visible [[key]] marker is opt-in only, for when
  // you're actively testing and don't want to keep devtools/logcat open:
  //   localStorage.setItem('td2tdr_i18n_debug', '1')  — or  ?i18n_debug=1
  const I18N_DEBUG = (() => {
    try {
      if (new URLSearchParams(location.search).get("i18n_debug") === "1") return true;
      return localStorage.getItem("td2tdr_i18n_debug") === "1";
    } catch (e) { return false; }
  })();

  function t(key, vars) {
    const dict = I18N[currentUiLang] || I18N.uk;
    let str = dict[key];
    let missing = false;

    if (str == null) {
      if (currentUiLang !== "uk") {
        console.warn(`[i18n] "${key}" missing for locale "${currentUiLang}" — falling back to uk`);
      }
      str = I18N.uk[key];
    }
    if (str == null) {
      console.warn(`[i18n] "${key}" missing from ALL locales — showing raw key`);
      str = key;
      missing = true;
    }

    if (vars) {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
      });
    }
    if (missing && I18N_DEBUG) str = `⚠[${str}]`;
    return str;
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.documentElement.setAttribute(
      "lang",
      currentUiLang === "en" ? "en" : "uk"
    );
    document.documentElement.style.setProperty("--lbl-open", `"${t("lbl_open")}"`);
    document.documentElement.style.setProperty("--lbl-sync", `"${t("lbl_sync")}"`);
    document.documentElement.style.setProperty("--lbl-done", `"${t("lbl_done")}"`);
  }

  function detectAutoUiLang() {
    try {
      const lang = (navigator.language || navigator.userLanguage || "").toLowerCase();
      if (lang.startsWith("uk")) return "uk";
      return "en";
    } catch (e) {
      return "uk";
    }
  }

  function updateUiLangSwitchUI(choice) {
    const switchEl = $("uiLangSwitch");
    if (!switchEl) return;
    switchEl.querySelectorAll(".theme-opt").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.uiLangChoice === choice);
    });
  }

  let currentUiLangChoice = "auto";

  async function loadUiLang() {
    await migrateAndRemoveCfg(UI_LANG_FILE, CFG_KEYS.ui_lang);
    let choice = lsGet(CFG_KEYS.ui_lang) || "auto";
    if (!["auto", "uk", "en"].includes(choice)) choice = "auto";
    currentUiLangChoice = choice;
    currentUiLang = choice === "auto" ? detectAutoUiLang() : choice;
    applyI18n();
    updateUiLangSwitchUI(choice);
  }

  async function setUiLang(choice) {
    currentUiLangChoice = choice;
    currentUiLang = choice === "auto" ? detectAutoUiLang() : choice;
    applyI18n();
    updateUiLangSwitchUI(choice);
    // refresh dynamic panels so already-rendered text updates immediately
    refresh();
    renderAnalytics();
    loadChangelog();
    renderLangUI();
    lsSet(CFG_KEYS.ui_lang, choice);
  }

  function initUiLangSwitch() {
    const switchEl = $("uiLangSwitch");
    if (!switchEl) return;
    switchEl.querySelectorAll(".theme-opt").forEach((btn) => {
      btn.addEventListener("click", () => setUiLang(btn.dataset.uiLangChoice));
    });
  }

  // ---- language list (value, flag, label) --------------------------------
  const LANGS = [
    { value: "", flag: "🌐", label: "Системна мова" },
    { value: "en_US", flag: "🇺🇸", label: "English" },
    { value: "fr_FR", flag: "🇫🇷", label: "Français" },
    { value: "de_DE", flag: "🇩🇪", label: "Deutsch" },
    { value: "hu_HU", flag: "🇭🇺", label: "Magyar" },
    { value: "it_IT", flag: "🇮🇹", label: "Italiano" },
    { value: "ja_JP", flag: "🇯🇵", label: "日本語" },
    { value: "ko_KR", flag: "🇰🇷", label: "한국어" },
    { value: "nl_NL", flag: "🇳🇱", label: "Nederlands" },
    { value: "pt_BR", flag: "🇧🇷", label: "Português (BR)" },
    { value: "ru_RU", flag: "🇷🇺", label: "Русский" },
    { value: "es_ES", flag: "🇪🇸", label: "Español" },
    { value: "es_MX", flag: "🇲🇽", label: "Español (MX)" },
    { value: "zh_CN", flag: "🇨🇳", label: "中文 (简体)" },
    { value: "zh_TW", flag: "🇹🇼", label: "中文 (繁體)" },
    { value: "fi_FI", flag: "🇫🇮", label: "Suomi" },
  ];
  let selectedLocale = "";

  function findLang(value) {
    return LANGS.find((l) => l.value === value) || LANGS[0];
  }

  async function saveLocale(locale) {
    // Мова гри тепер у localStorage (файл locale з папки видалено).
    // Активне застосування відбувається через cmd locale у applyLocale.
    if (locale) {
      lsSet(CFG_KEYS.game_locale, locale);
    } else {
      try { localStorage.removeItem(CFG_KEYS.game_locale); } catch (e) {}
    }
  }

  async function migrateGameLocale() {
    await migrateAndRemoveCfg(LANG_FILE, CFG_KEYS.game_locale);
  }

  // Ask Android's LocaleManager what language the game is actually running
  // with right now, so the dropdown opens already showing the real state.
  async function queryActiveLocale() {
    if (!hasKsu()) return "";
    const { errno, stdout } = await exec(
      `cmd locale get-app-locales com.hutchgames.cccg --user 0 2>/dev/null`
    );
    if (errno !== 0) return "";
    const m = stdout.match(/\[([^\]]*)\]/);
    if (!m || !m[1].trim()) return ""; // [] = following system locale
    return m[1].trim().replace("-", "_"); // "ru-RU" -> "ru_RU"
  }

  // ---- helpers ----------------------------------------------------------
  function formatBytes(n) {
    if (n == null || isNaN(n)) return "—";
    const units = [t("unit_b"), t("unit_kb"), t("unit_mb"), t("unit_gb")];
    let v = Number(n), i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async function statPath(path) {
    const { errno, stdout } = await exec(`stat -c '%s %Y' ${shellQuote(path)} 2>/dev/null`);
    if (errno !== 0 || !stdout.trim()) return null;
    const [size, mtime] = stdout.trim().split(/\s+/);
    return { size: Number(size), mtime: Number(mtime) };
  }

  // stat по черзі кількох кандидатів — перший успішний виграє. Обов'язково
  // для /storage/emulated/0 шляхів: у частині ROM shell WebUI не бачить
  // FUSE-вид /storage, хоча файл реально існує через /data/media/0.
  async function statFirst(paths) {
    for (const p of paths) {
      const st = await statPath(p);
      if (st) return st;
    }
    return null;
  }

  // Останній шлях, де Garage.dat було успішно знайдено — перевіряємо його
  // першим, щоб не гоняти весь ланцюжок кандидатів щоразу.
  let garagePathHint = null;

  // ЄДИНЕ ДЖЕРЕЛО ПРАВДИ про наявність копії Garage.dat. Використовується
  // скрізь: стартова перевірка, статус-панель і верифікація в модалці.
  // 1) stat по кандидатах (кешований шлях -> /storage -> /data/media);
  // 2) якщо stat не спрацював ніде (транзієнт FUSE одразу після перезапису
  //    файла, відсутність stat-бінарії тощо) — резервний probe через
  //    test -s + wc -c, тобто інший код-шлях усередині shell.
  async function checkGarageExists() {
    const seen = new Set();
    const candidates = [];
    for (const p of [garagePathHint, DST, DST_ALT]) {
      if (p && !seen.has(p)) { seen.add(p); candidates.push(p); }
    }
    let st = await statFirst(candidates);
    if (st) {
      // Запам'ятовуємо конкретний вдалий шлях для пріоритету наступного разу
      for (const p of candidates) {
        const one = await statPath(p);
        if (one) { garagePathHint = p; break; }
      }
      return st;
    }
    // Резервний probe (без stat-бінарії)
    for (const p of candidates) {
      const r = await exec(`test -s ${shellQuote(p)} && wc -c < ${shellQuote(p)}`);
      if (r.errno === 0 && Number(r.stdout.trim()) > 0) {
        garagePathHint = p;
        return { size: Number(r.stdout.trim()), mtime: Math.floor(Date.now() / 1000) };
      }
    }
    return null;
  }

  // ---- session log (in-panel, exportable) --------------------------------
  const sessionLog = [];
  const LOG_FILE = "/sdcard/Download/td2tdr_log.txt";
  let logWorstLevel = "I"; // worst level seen this session — drives the "log" tab indicator
  function addLog(msg, level) {
    // Level is ALWAYS explicit now — no more sniffing translated text for
    // keywords like "ПОМИЛКА"/"error", which broke the moment messages got
    // localized (an English "sync error" log used to silently classify as
    // info-level and never trip the Journal tab indicator). Every call site
    // that represents a real problem passes "E"/"W" explicitly; everything
    // else defaults to "I".
    const lvl = level || "I";
    const ts = new Date().toLocaleTimeString("uk-UA");
    const line = `[${ts}] ${msg}`;
    sessionLog.push(line);
    if (lvl === "E") logWorstLevel = "E";
    else if (lvl === "W" && logWorstLevel !== "E") logWorstLevel = "W";
    setTabIndicator("log", logWorstLevel === "E" ? "bad" : logWorstLevel === "W" ? "warn" : "ok");
    const el = $("log");
    if (el) {
      const empty = el.querySelector('[data-i18n="log_empty"]');
      if (empty) empty.remove();
      const d = document.createElement("div");
      d.className = "log-line new";
      // Коротка підсвітка нового рядка — чіткий фідбек, що журнал оновився
      setTimeout(() => d.classList.remove("new"), 1200);
      d.dataset.level = lvl;
      d.innerHTML = `<span class="log-time">${ts}</span><span class="log-level log-level-${lvl.toLowerCase()}">${lvl}</span> ${escapeHtml(msg)}`;
      const filter = $("logLevelFilter");
      if (filter && filter.value !== "all" && filter.value !== lvl) {
        d.style.display = "none";
      }
      el.appendChild(d);
      el.scrollTop = el.scrollHeight;
    }
    // append to file on device (fire-and-forget)
    if (hasKsu()) {
      exec(`echo ${shellQuote(line)} >> ${shellQuote(LOG_FILE)}`).catch(() => {});
    }
  }

  // ---- sync progress modal: step rows -------------------------------------
  function syncStepRow(id, label) {
    return `<div class="sync-step" id="step-${id}">
      <span class="sync-step-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
      <span class="sync-step-label">${escapeHtml(label)}</span>
      <span class="sync-step-detail"></span>
    </div>`;
  }

  function setStepState(id, state, label, detail) {
    const el = document.getElementById(`step-${id}`);
    if (!el) return;
    el.classList.remove("active", "done", "error");
    el.classList.add(state);
    if (label) {
      const l = el.querySelector(".sync-step-label");
      if (l) l.textContent = label;
    }
    const d = el.querySelector(".sync-step-detail");
    if (d) d.textContent = detail || "";
  }


  async function syncFile() {
    if (!hasKsu()) {
      // Demo/browser-preview mode — there's no root bridge to copy anything
      // with. Fail gracefully with a clear message instead of letting the
      // exec() rejection bubble up uncaught and permanently freeze the
      // caller's button/spinner state.
      addLog(t("log_sync_unavailable_demo"), "W");
      return false;
    }
    try {
      const { errno, stderr, stdout } = await exec(`sh ${shellQuote(MODDIR + "/sync_now.sh")}`);
      if (errno !== 0) {
        addLog(t("log_sync_error", { reason: stderr || stdout || t("log_code", { code: errno }) }), "E");
        return false;
      }
      // Верифікація результату копіювання: скрипт міг вийти з 0, не створивши
      // файл. Чітко фіксуємо в Журналі: УСПІХ (з розміром) або ПОМИЛКА.
      const st = await checkGarageExists();
      if (st && st.size > 0) {
        garageEverReady = true;
        dstReady = true;
        updateSyncGate(true);
        saveStateCache(st);
        addLog(t("log_copy_ok", { size: formatBytes(st.size) }));
      } else {
        addLog(t("log_copy_fail"), "E");
        return false;
      }
      return true;
    } catch (e) {
      // Defense in depth: any other unexpected exec() failure should degrade
      // the same way — never let this function reject and strand the caller.
      addLog(t("log_sync_error", { reason: e.message }), "E");
      return false;
    }
  }

  // ---- real browser open (system default, via Android intent) ------------
  async function openUrl(url) {
    if (!hasKsu()) {
      addLog(t("log_open_unavailable_demo"), "W");
      return false;
    }
    try {
      const cmd = `am start -a android.intent.action.VIEW -d ${shellQuote(url)} -c android.intent.category.BROWSABLE`;
      const { errno, stderr } = await exec(cmd);
      if (errno !== 0) {
        addLog(t("log_open_link_failed", { reason: stderr || t("log_code", { code: errno }) }), "E");
        toast(t("toast_open_link_failed"));
        return false;
      }
      return true;
    } catch (e) {
      addLog(t("log_open_link_failed", { reason: e.message }), "E");
      toast(t("toast_open_link_failed"));
      return false;
    }
  }

  // ---- convert xx_YY -> xx-YY (BCP-47, required by `cmd locale`) --------
  function toBcp47(locale) {
    return locale ? locale.replace("_", "-") : "";
  }

  // ---- custom language dropdown ------------------------------------------
  function langLabel(l) {
    return l.value === "" ? t("lang_system") : l.label;
  }

  function renderLangUI() {
    const menu = $("langMenu");
    if (!menu) return;
    menu.innerHTML = LANGS.map((l) => `
      <div class="lang-option${l.value === selectedLocale ? " selected" : ""}" role="option" data-value="${l.value}">
        <span class="lang-flag">${l.flag}</span>
        <span class="lang-opt-label">${escapeHtml(langLabel(l))}</span>
        <svg class="lang-check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
    `).join("");
    menu.querySelectorAll(".lang-option").forEach((el) => {
      el.addEventListener("click", () => {
        selectedLocale = el.dataset.value;
        renderLangUI();
        setLangOpen(false);
      });
    });
    const cur = findLang(selectedLocale);
    $("langTriggerFlag").textContent = cur.flag;
    $("langTriggerLabel").textContent = langLabel(cur);
  }

  function setLangOpen(open) {
    const dropdown = $("langDropdown");
    const menu = $("langMenu");
    const trigger = $("langTrigger");
    if (!dropdown || !menu || !trigger) return;
    dropdown.classList.toggle("open", open);
    menu.classList.toggle("open", open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");

    if (open) {
      // Reposition the menu against the trigger button and reparent it to
      // <body> so it escapes the card's `isolation: isolate` stacking
      // context — otherwise later cards on the page (Ресурси, Гараж…)
      // would paint on top of the open list instead of behind it.
      const rect = trigger.getBoundingClientRect();
      menu.style.position = "fixed";
      menu.style.top = `${rect.bottom + 6}px`;
      menu.style.left = `${rect.left}px`;
      menu.style.width = `${rect.width}px`;
      document.body.appendChild(menu);
    } else {
      dropdown.appendChild(menu);
      menu.style.position = "";
      menu.style.top = "";
      menu.style.left = "";
      menu.style.width = "";
    }
  }

  function initLangDropdown() {
    const trigger = $("langTrigger");
    const dropdown = $("langDropdown");
    if (!trigger || !dropdown) return;
    renderLangUI();
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      setLangOpen(!dropdown.classList.contains("open"));
    });
    document.addEventListener("click", (e) => {
      const menu = $("langMenu");
      if (!dropdown.contains(e.target) && !(menu && menu.contains(e.target))) {
        setLangOpen(false);
      }
    });
  }

  // ---- apply language (per-app LocaleManager + relaunch) -----------------
  async function applyLocale() {
    const btn = $("saveLangBtn");
    if (btn.classList.contains("onclic") || btn.classList.contains("validate") || btn.classList.contains("warn")) return;

    const locale = selectedLocale; // e.g. "ru_RU" or "" for system default
    const bcp47 = toBcp47(locale);
    btn.disabled = true;
    btn.classList.remove("validate", "warn");
    btn.classList.add("onclic");

    await saveLocale(locale);
    addLog(t("log_locale_set", { locale: locale || t("log_locale_system") }));

    // Track whether the locale ACTUALLY changed via either mechanism — this
    // (not whether the game merely launches afterward) is what should drive
    // the success indicator. Launching the game basically never fails
    // regardless of locale, so gating the checkmark on that alone used to
    // show "success" even when neither mechanism below did anything.
    let localeConfirmed = false;

    // --- Primary mechanism: Android per-app language (LocaleManager) ---
    // This is what Settings > Apps > App language uses under the hood.
    // Empty string resets the app back to following the system language.
    const { errno: locErr, stderr: locStderr } = await exec(
      `cmd locale set-app-locales com.hutchgames.cccg --user 0 --locales ${shellQuote(bcp47)}`
    );
    if (locErr !== 0) {
      addLog(t("log_cmd_locale_error", { reason: locStderr || t("log_code", { code: locErr }) }), "E");
    } else {
      localeConfirmed = true;
      const { stdout: verifyOut } = await exec(
        `cmd locale get-app-locales com.hutchgames.cccg --user 0`
      );
      addLog(t("log_per_app_locale_applied", { check: verifyOut.trim() || "?" }));
    }

    // --- Fallback: patch cached prefs keys too, in case the game reads
    // them before re-evaluating LocaleManager on some cold starts. As of
    // this fix, set_locale.sh's exit code honestly reflects whether it
    // found and modified anything — it no longer reports success just for
    // running without a shell error. Its one-line stdout summary is logged
    // directly here instead of only being written to the (WebUI-invisible)
    // sync.log file. ---
    if (locale) {
      const scriptPath = `${MODDIR}/set_locale.sh`;
      const { errno: shErr, stdout: shStdout, stderr: shStderr } = await exec(
        `sh ${shellQuote(scriptPath)} ${shellQuote(locale)}`
      );
      const summary = shStdout.trim();
      if (shErr !== 0) {
        addLog(t("log_set_locale_sh_error", { reason: summary || shStderr || t("log_code", { code: shErr }) }), "E");
      } else {
        localeConfirmed = true;
        addLog(t("log_set_locale_sh_done", { locale, summary: summary || "OK" }));
      }
    }

    addLog(t("log_stopping_game"));
    await exec(`am force-stop com.hutchgames.cccg`);
    await new Promise(r => setTimeout(r, 1000));
    addLog(t("log_starting_game"));
    const { errno } = await exec(
      `am start -n com.hutchgames.cccg/com.hutchgames.racegame.UnityPlayerActivity`
    );

    btn.classList.remove("onclic");
    if (errno !== 0) {
      // Game itself failed to (re)launch — this is a real, separate failure.
      addLog(t("log_game_start_failed"), "E");
      toast(t("toast_game_start_failed"));
    } else if (localeConfirmed) {
      // Game restarted AND at least one locale mechanism confirmed it
      // actually changed something — this is the only case that earns the
      // green checkmark.
      btn.classList.add("validate");
      setTimeout(() => btn.classList.remove("validate"), 1250);
      addLog(t("log_game_started"));
      toast(t("toast_locale_applied"));
    } else {
      // Game restarted, but neither mechanism confirmed an actual change —
      // don't lie with a green checkmark. Amber = "restarted, but the
      // language may not have actually changed — check the Журнал".
      btn.classList.add("warn");
      setTimeout(() => btn.classList.remove("warn"), 2000);
      addLog(t("log_game_started"));
      addLog(t("log_locale_unconfirmed"), "W");
      toast(t("toast_locale_unconfirmed"));
    }
    btn.disabled = false;
  }

  // ---- diagnose locale keys -------------------------------------------
  async function diagnoseLocale() {
    const GAME_PKG = "com.hutchgames.cccg";
    const SHARED_PREFS = `/data/data/${GAME_PKG}/shared_prefs`;
    addLog(t("log_diag_start"));
    addLog(t("log_diag_path", { path: SHARED_PREFS }));

    const { errno: lsErr, stdout: lsOut } = await exec(`ls ${shellQuote(SHARED_PREFS)}/*.xml 2>/dev/null`);
    if (lsErr !== 0 || !lsOut.trim()) {
      addLog(t("log_diag_no_prefs"));
      return;
    }
    const files = lsOut.trim().split(/\s+/);
    for (const f of files) {
      addLog(t("log_diag_file", { file: f.split("/").pop() }));
      const { stdout } = await exec(`grep '<string ' ${shellQuote(f)} 2>/dev/null`);
      if (stdout.trim()) {
        const lines = stdout.trim().split("\n");
        for (const line of lines) {
          addLog(`  ${line.trim()}`);
        }
      } else {
        addLog(t("log_diag_no_entries"));
      }
    }
    addLog(t("log_diag_end"));
  }

  // ---- status refresh -------------------------------------------------
  async function refresh() {
    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.classList.add("spinning");
    // try/finally гарантує, що спінер зніметься навіть якщо statPath/парсинг
    // кинуть виняток — інакше кнопка «Оновити» назавжди залишалась обертовою.
    try {
      await refreshInner();
    } finally {
      if (refreshBtn) refreshBtn.classList.remove("spinning");
      // Гейт головної кнопки: активна лише коли копія реально знайдена
      updateSyncGate(dstReady);
    }
  }

  async function refreshInner() {
    if (!hasKsu()) {
      dstReady = true; // демо-режим: вважаємо все готовим
      $("statusMeta").textContent = t("status_demo_mode");
      $("checkSrc").className = "flow-dot ok";
      $("checkDst").className = "flow-dot ok";
      $("checkResult").className = "flow-dot ok";
      if ($("srcFlowStatus")) $("srcFlowStatus").textContent = t("flow_demo_size", { size: "1.2 MB" });
      if ($("dstFlowStatus")) $("dstFlowStatus").textContent = t("flow_demo_size", { size: "1.2 MB" });
      if ($("resultFlowStatus")) $("resultFlowStatus").textContent = t("flow_in_sync");
      if (refreshBtn) refreshBtn.classList.remove("spinning");
      setTabIndicator("sync", "ok");
      await loadGarageStats();
      await renderAnalytics();
      return;
    }

    const src = await statFirst([SRC, SRC_ROOT]);
    // Єдине джерело правди для копії — checkGarageExists (stat + fallback
    // probe + кеш вдалого шляху). Копія фізично є — кнопка розблоковується.
    const dst = await checkGarageExists();
    if (dst) garageEverReady = true;
    // Липкість: раз готовий — завжди готовий (файл міг транзієнтно бути
    // недоступний для stat під час перезапису, це не привід скидати статус).
    dstReady = !!dst || garageEverReady;

    const checkSrc = $("checkSrc");
    const checkDst = $("checkDst");
    const checkResult = $("checkResult");
    const statusIcon = $("statusIcon");
    const srcFlowStatus = $("srcFlowStatus");
    const dstFlowStatus = $("dstFlowStatus");
    const resultFlowStatus = $("resultFlowStatus");

    // Ефективний стан копії: якщо гараж вже був підтверджений (липкий
    // прапорець), транзієнтна невдача stat НЕ скидає статус у «Копії ще немає».
    const effDst = dst || (garageEverReady ? { size: null, mtime: 0 } : null);

    checkSrc.className = `flow-dot ${src ? "ok" : "bad"}`;
    checkDst.className = `flow-dot ${effDst ? "ok" : "warn"}`;
    if (srcFlowStatus) srcFlowStatus.textContent = src ? `${t("flow_found")} · ${formatBytes(src.size)}` : t("flow_not_found_src");
    if (dstFlowStatus) dstFlowStatus.textContent = effDst
      ? `${t("flow_found")}${dst ? ` · ${formatBytes(dst.size)}` : ""}`
      : t("flow_not_found_dst");

    if (src && effDst) {
      const inSync = dst ? src.size === dst.size : true; // липкий стан = вважаємо синхр.
      checkResult.className = `flow-dot ${inSync ? "ok" : "warn"}`;
      if (resultFlowStatus) resultFlowStatus.textContent = inSync ? t("flow_in_sync") : t("flow_diff");
      if (statusIcon) statusIcon.className = `status-icon ${inSync ? "ok" : "warn"}`;
      $("statusMeta").textContent = !dst && garageEverReady
        ? t("status_ready_sticky")
        : (inSync
          ? t("status_synced", { size: formatBytes(dst.size) })
          : t("status_size_mismatch", { src: formatBytes(src.size), dst: formatBytes(dst.size) }));
      setTabIndicator("sync", inSync ? "ok" : "warn");
    } else if (!src) {
      checkResult.className = "flow-dot bad";
      if (resultFlowStatus) resultFlowStatus.textContent = t("status_dash");
      if (statusIcon) statusIcon.className = "status-icon bad";
      $("statusMeta").textContent = t("status_no_garage");
      setTabIndicator("sync", "bad");
    } else {
      checkResult.className = "flow-dot warn";
      if (resultFlowStatus) resultFlowStatus.textContent = t("flow_need");
      if (statusIcon) statusIcon.className = "status-icon warn";
      $("statusMeta").textContent = t("status_no_copy");
      setTabIndicator("sync", "warn");
    }

    // Оновлюємо дату останньої синхронізації лише при реальному stat-успіху,
    // щоб липкий стан не переписував її на 1970 рік.
    if (dst) $("lastSync").textContent = new Date(dst.mtime * 1000).toLocaleString("uk-UA");

    if (refreshBtn) refreshBtn.classList.remove("spinning");
  }

  // ---- full refresh: sync file + status check + garage + analytics -------
  let refreshInFlight = false;
  // Готовність копії Garage.dat: true лише коли файл фізично знайдено
  // (stat успішний хоча б по одному зі шляхів). Керує доступністю кнопки
  // «Синхронізувати та відкрити» — перехід на сайт блокується, поки false.
  let dstReady = false;
  // «Липкий» прапорець: щойно гараж було проаналізовано (WebUI зчитав дані)
  // або копію фізично знайдено — статус більше НІКОЛИ не відкочується до
  // «Копії ще немає» при повторних перевірках/натисканнях.
  let garageEverReady = false;

  // ---- кеш останнього стану (localStorage) --------------------------------
  // Після першого вдалого копіювання стан зберігається, і при кожному
  // наступному відкритті WebUI малюється МИТТЄВО з кешу — без «Не завантажено»
  // і без очікування shell-команд. Повторне читання/копіювання — тільки
  // за кнопкою «Синхронізувати та відкрити» або «Оновити».
  const STATE_CACHE_KEY = "td2tdr_last_state";
  function saveStateCache(st) {
    try {
      localStorage.setItem(STATE_CACHE_KEY, JSON.stringify({ size: st.size, mtime: st.mtime, ts: Date.now() }));
    } catch (e) {}
  }
  function paintCachedState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STATE_CACHE_KEY) || "null"); } catch (e) {}
    if (!s || !s.size) return false;
    dstReady = true;
    garageEverReady = true;
    updateSyncGate(true);
    $("statusMeta").textContent = t("status_synced", { size: formatBytes(s.size) });
    $("lastSync").textContent = s.mtime ? new Date(s.mtime * 1000).toLocaleString("uk-UA") : "—";
    const cr = $("checkResult"), cd = $("checkDst"), cs = $("checkSrc");
    if (cr) cr.className = "flow-dot ok";
    if (cd) cd.className = "flow-dot ok";
    if (cs) cs.className = "flow-dot ok";
    const si = $("statusIcon");
    if (si) si.className = "status-icon ok";
    setTabIndicator("sync", "ok");
    return true;
  }

  // Оновлює доступність головної кнопки відповідно до стану синхронізації.
  // Не чіпає кнопку посеред активної анімації (onclic/validate/error).
  // Динамічний «настрій» кнопки: glow-анімація в тон статусу
  function setBtnMood(mood) {
    const btn = $("syncAndOpen");
    if (!btn) return;
    btn.classList.remove("mood-ok", "mood-warn");
    if (mood === "ok") btn.classList.add("mood-ok");
    else if (mood === "warn") btn.classList.add("mood-warn");
    // "bad" не липнемо: червона швидка анімація живе лише у класі .error
  }

  function updateSyncGate(ready0) {
    const btn = $("syncAndOpen");
    if (!btn) return;
    if (!hasKsu()) { btn.disabled = false; setBtnMood("ok"); return; } // демо-режим браузера
    const busy = btn.classList.contains("onclic") || btn.classList.contains("validate") || btn.classList.contains("error");
    if (!busy) {
      const ready = ready0 || garageEverReady;
      btn.disabled = !ready;
      btn.title = ready ? "" : t("btn_wait_sync");
      setBtnMood(ready ? "ok" : "warn");
    }
  }


  // Just the part the default-active "Синхр." tab needs — used at startup
  // so the essential status shows up fast without waiting on Гараж/Аналітика.
  async function refreshEssential() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      // Швидка попередня перевірка ДО синхронізації: якщо копія вже лежить
      // у Download/td2tdr_sync (наприклад, service.sh відпрацював при boot),
      // статус має стати зеленим НЕГАЙНО — без проміжного «Копії ще немає»,
      // поки йде фонове оновлення файлів.
      const pre = await checkGarageExists();
      if (pre) {
        dstReady = true;
        garageEverReady = true;
        saveStateCache(pre);
        updateSyncGate(true);
        $("statusMeta").textContent = t("status_synced", { size: formatBytes(pre.size) });
        const cr = $("checkResult"), cd = $("checkDst");
        if (cr) cr.className = "flow-dot ok";
        if (cd) cd.className = "flow-dot ok";
        const si = $("statusIcon");
        if (si) si.className = "status-icon ok";
        setTabIndicator("sync", "ok");
        $("lastSync").textContent = pre.mtime
          ? new Date(pre.mtime * 1000).toLocaleString("uk-UA")
          : "—";
      }
      await syncFile();
      await refresh();
    } finally {
      refreshInFlight = false;
    }
  }

  async function refreshAll() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await syncFile();
      await refresh();
      await loadGarageStats();
      await recordSnapshotIfNeeded();
      await renderAnalytics();
    } finally {
      refreshInFlight = false;
    }
  }

  // ---- settings (local display-only; real paths are fixed above) ---------
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem("td2tdr_settings") || "{}");
      $("srcPathDisplay").textContent = s.src || SRC;
      $("dstPathDisplay").textContent = s.dst || DST_DIR;
    } catch (e) {}
  }

  // ---- garage stats (parses the synced Garage.dat locally) --------------
  function upgradeKey(card) {
    const key = `${card.engineMajor}${card.weightMajor}${card.chassisMajor}`;
    if (key === "111" || key === "332" || key === "323" || key === "233") return key;
    return "custom";
  }

  const UPGRADE_LABELS = {
    "111": "1-1-1",
    "332": "3-3-2",
    "323": "3-2-3",
    "233": "2-3-3",
    "custom": "Інше",
  };

  function readFile(path) {
    // .catch(() => "") matters: exec() REJECTS outright when there's no ksu
    // bridge (e.g. previewing the WebUI in a plain PC browser). Without this,
    // that rejection propagated as a raw, hardcoded-Ukrainian "ksu bridge
    // недоступний" error out of every consumer (loadGarageStats, loadResources,
    // analytics snapshots) — which also silently made their MOCK_*_DAT demo
    // fallbacks unreachable, since the `await` threw before ever getting to
    // the "no data" check that triggers them.
    return exec(`cat ${shellQuote(path)} 2>/dev/null`)
      .then((r) => (r.errno === 0 && r.stdout ? r.stdout : ""))
      .catch(() => "");
  }

  // читаємо файл-джерело; приймає будь-яку кількість кандидатів і повертає
  // перший непорожній результат. Порядок: стандартний шлях → /data/media/0
  // (Scoped Storage fallback) → синхронізована копія у Download.
  async function readSourceFile() {
    for (const p of arguments) {
      const data = await readFile(p);
      if (data) return data;
    }
    return "";
  }

  // Mock-дані для перегляду в браузері на ПК (коли немає KernelSU / Magisk)
  const MOCK_USER_DAT = "Cash=00000000,i1450200\nGold=00000000,i3850\nFestivalPasses=00000000,i820\n";
  const MOCK_CARDS = Array.from({ length: 95 }, (_, i) => ({
    locked: i < 38,
    state: 1,
    tuning0: i % 4 === 0 ? 3 : 1,
    tuning1: i % 4 === 0 ? 3 : (i % 3 === 0 ? 2 : 1),
    tuning2: i % 4 === 0 ? 2 : (i % 3 === 0 ? 3 : 1),
    cardWins: 10 + (i * 3) % 40,
    cardLosses: (i * 2) % 15,
    cardDraws: i % 4
  }));
  const MOCK_GARAGE_DAT = `PlayerDeck=00000000,s${JSON.stringify(MOCK_CARDS)}\n`;
  const MOCK_HISTORY = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return {
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      cash: 800000 + i * 50000 + (i % 2 ? 15000 : -5000),
      gold: 2000 + i * 140,
      prestige: Math.min(1000, 400 + i * 32),
      garage: 60 + i * 2
    };
  });

  async function loadResources() {
    let data = await readSourceFile(SRC_USER, SRC_USER_ROOT, DST_USER);
    if (!data && !hasKsu()) {
      data = MOCK_USER_DAT;
    }
    if (!data) {
      $("resourcesEmpty").style.display = "block";
      $("resourcesGrid").style.display = "none";
      return;
    }
    const val = (key) => {
      const m = data.match(new RegExp(`${key}=[0-9A-F]{8},i(\\d+)`));
      return m ? Number(m[1]) : null;
    };
    $("resCash").textContent = val("Cash") != null ? val("Cash").toLocaleString("uk-UA") : "—";
    $("resGold").textContent = val("Gold") != null ? val("Gold").toLocaleString("uk-UA") : "—";
    const fest = val("FestivalPasses");
    const PRESTIGE_MAX = 1000;
    const prestigeTile = document.querySelector(".res-tile-prestige");
    if (fest != null) {
      const pct = Math.min(100, (fest / PRESTIGE_MAX) * 100);
      const fill = $("prestigeFill");
      fill.style.width = pct + "%";
      fill.className = "prestige-progress-fill p-" + (pct >= 90 ? "red" : pct >= 75 ? "orange" : pct >= 50 ? "yellow" : "green");
      $("prestigeText").textContent = `${fest.toLocaleString("uk-UA")} / ${PRESTIGE_MAX.toLocaleString("uk-UA")}`;
      if (prestigeTile) prestigeTile.setAttribute("aria-valuenow", String(Math.round(pct)));
      const warn = $("prestigeWarn");
      if (fest >= 900) {
        warn.textContent = t("res_prestige_overflow_warn");
        warn.style.display = "block";
      } else {
        warn.style.display = "none";
      }
    } else {
      $("prestigeText").textContent = `— / ${PRESTIGE_MAX.toLocaleString("uk-UA")}`;
      $("prestigeFill").style.width = "0%";
      $("prestigeFill").className = "prestige-progress-fill";
      if (prestigeTile) prestigeTile.setAttribute("aria-valuenow", "0");
    }
    $("resourcesEmpty").style.display = "none";
    $("resourcesGrid").style.display = "flex";
    addLog(t("log_resources_loaded"));
  }

  // Stacked-bar renderer for upgrades (sorted descending by count) —
  // replaces the old donut chart, whose on-ring % labels overlapped when
  // a segment was a small slice. Now counts/percentages live in the legend
  // text instead of being crammed onto the shape itself.
  //
  // Segments are updated IN PLACE (not torn down and rebuilt) so the
  // flex-basis CSS transition can actually animate between renders, and so
  // repeated calls don't keep replacing the same DOM nodes for no reason.
  function fmtPct(pct) {
    // locale-aware, up to 1 decimal (uk-UA renders "12,5%", not "12.5%")
    return pct.toLocaleString(currentUiLang === "en" ? "en-US" : "uk-UA", { maximumFractionDigits: 1 }) + "%";
  }

  function renderUpgradeBar(parts, counts, total) {
    const trackEl = $("upgradeStackTrack");
    const legendEl = $("upgradeLegend");
    const totalEl = $("upgradeStackVal");
    if (!trackEl || !legendEl) return;

    if (totalEl) totalEl.textContent = total.toLocaleString("uk-UA");

    const sortedParts = [...parts].sort((a, b) => (counts[b.k] || 0) - (counts[a.k] || 0));
    const visibleParts = sortedParts.filter((p) => (counts[p.k] || 0) > 0);

    trackEl.setAttribute("role", "img");
    trackEl.setAttribute(
      "aria-label",
      visibleParts.map((p) => `${p.label}: ${fmtPct(total ? (counts[p.k] / total) * 100 : 0)}`).join(", ")
    );

    // ---- segments: update existing nodes in place, add/remove only what changed ----
    const wantedIds = new Set(visibleParts.map((p) => `upgSeg_${p.k}`));
    Array.from(trackEl.children).forEach((child) => {
      if (!wantedIds.has(child.id)) child.remove(); // category disappeared (e.g. now 0 cars)
    });

    let prevNode = null;
    visibleParts.forEach((p) => {
      const cnt = counts[p.k] || 0;
      const pct = total ? (cnt / total) * 100 : 0;
      const id = `upgSeg_${p.k}`;
      let seg = document.getElementById(id);
      if (!seg) {
        seg = document.createElement("div");
        seg.className = "upgrade-stack-seg";
        seg.id = id;
        seg.dataset.key = p.k;
        seg.style.background = p.color;
        seg.addEventListener("mouseenter", () => highlight(p.k));
        seg.addEventListener("mouseleave", reset);
      }
      seg.style.flexBasis = pct + "%";
      seg.title = `${p.label}: ${cnt.toLocaleString("uk-UA")} (${fmtPct(pct)})`;
      // keep DOM order matching sort order (cheap: at most 5 nodes)
      if (prevNode ? prevNode.nextSibling !== seg : trackEl.firstChild !== seg) {
        trackEl.insertBefore(seg, prevNode ? prevNode.nextSibling : trackEl.firstChild);
      }
      prevNode = seg;
    });

    // ---- legend: plain text content, cheap to fully re-render ----
    let legendHtml = "";
    sortedParts.forEach((p) => {
      const cnt = counts[p.k] || 0;
      const pct = total ? (cnt / total) * 100 : 0;
      legendHtml += `
        <div class="donut-legend-item" id="donutLeg_${p.k}" data-key="${p.k}">
          <div class="donut-legend-left">
            <span class="donut-legend-dot" style="background:${p.color}"></span>
            <span>${escapeHtml(p.label)}</span>
          </div>
          <div class="donut-legend-right">
            <span class="donut-legend-pct">${total ? fmtPct(pct) : ""}</span>
            <span class="donut-legend-val">${cnt.toLocaleString("uk-UA")}</span>
          </div>
        </div>
      `;
    });
    legendEl.innerHTML = legendHtml;

    // ---- міні-donut поруч із відсотками (преміальний акцент блоку) ----
    const donutEl = $("upgradeDonut");
    if (donutEl) {
      const R = 26, C = 2 * Math.PI * R;
      let offset = 0;
      let segs = "";
      sortedParts.forEach((p) => {
        const cnt = counts[p.k] || 0;
        if (!cnt || !total) return;
        const frac = cnt / total;
        segs += `<circle cx="32" cy="32" r="${R}" fill="none" stroke="${p.color}" stroke-width="9" stroke-dasharray="${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}" stroke-dashoffset="${(-offset * C).toFixed(2)}" transform="rotate(-90 32 32)"></circle>`;
        offset += frac;
      });
      donutEl.innerHTML = `
        <svg viewBox="0 0 64 64" class="upgrade-donut-svg">
          <circle cx="32" cy="32" r="${R}" fill="none" stroke="rgba(127,127,127,0.15)" stroke-width="9"></circle>
          ${segs}
          <text x="32" y="30" text-anchor="middle" class="upgrade-donut-num">${total.toLocaleString("uk-UA")}</text>
          <text x="32" y="42" text-anchor="middle" class="upgrade-donut-lbl">${escapeHtml(t("garage_total_cars"))}</text>
        </svg>`;
    }

    function highlight(key) {
      sortedParts.forEach((p) => {
        const seg = document.getElementById(`upgSeg_${p.k}`);
        const leg = $(`donutLeg_${p.k}`);
        if (seg) seg.classList.toggle("dim", p.k !== key);
        if (leg) leg.classList.toggle("active", p.k === key);
      });
    }
    function reset() {
      sortedParts.forEach((p) => {
        const seg = document.getElementById(`upgSeg_${p.k}`);
        const leg = $(`donutLeg_${p.k}`);
        if (seg) seg.classList.remove("dim");
        if (leg) leg.classList.remove("active");
      });
    }

    sortedParts.forEach((p) => {
      const leg = $(`donutLeg_${p.k}`);
      if (leg) {
        leg.addEventListener("mouseenter", () => highlight(p.k));
        leg.addEventListener("mouseleave", reset);
      }
    });
  }

  // ---- LEGACY donut renderer — kept only as a safety-net rollback path.
  // Not called anywhere; the donut's on-ring % labels are what caused the
  // overlap bug that renderUpgradeBar() above was written to fix. To roll
  // back: restore the .garage-donut-wrap markup (see project history /
  // earlier changelog entry) in index.html and call renderUpgradeDonutLegacy
  // instead of renderUpgradeBar in loadGarageStats().
  /*
  function renderUpgradeDonutLegacy(parts, counts, total) {
    // ... original donut implementation preserved in git history ...
  }
  */

  // Шкала боїв у стилі престижу з сегментним градієнтом
  function renderBattleBar(battle, total) {
    const winsEl = $("battleWins");
    const drawsEl = $("battleDraws");
    const lossesEl = $("battleLosses");
    const barBg = $("battleBarBg");
    const tile = $("battleTile");

    if (winsEl) winsEl.textContent = (battle.w || 0).toLocaleString("uk-UA");
    if (drawsEl) drawsEl.textContent = (battle.d || 0).toLocaleString("uk-UA");
    if (lossesEl) lossesEl.textContent = (battle.l || 0).toLocaleString("uk-UA");
    if (tile) {
      tile.setAttribute(
        "aria-label",
        `${t("garage_battles")}: ${(battle.w || 0)} W, ${(battle.d || 0)} D, ${(battle.l || 0)} L`
      );
    }

    if (barBg) {
      if (!total) {
        barBg.style.background = "transparent";
      } else {
        const winPct = (battle.w / total) * 100;
        const drawPct = winPct + (battle.d / total) * 100;
        barBg.style.background = `linear-gradient(90deg, 
          rgba(61, 220, 132, 0.28) 0%, 
          rgba(61, 220, 132, 0.28) ${winPct}%, 
          rgba(255, 181, 69, 0.28) ${winPct}%, 
          rgba(255, 181, 69, 0.28) ${drawPct}%, 
          rgba(255, 92, 122, 0.28) ${drawPct}%, 
          rgba(255, 92, 122, 0.28) 100%)`;
      }
    }
  }

  async function loadGarageStats() {
    const loadBtn = $("loadGarage");
    if (loadBtn) { loadBtn.disabled = true; loadBtn.textContent = t("garage_analyzing"); }
    try {
      let data = await readSourceFile(SRC, SRC_ROOT, DST);
      if (!data && !hasKsu()) {
        data = MOCK_GARAGE_DAT;
      }
      if (!data) {
        addLog(t("log_garage_not_found", { path: SRC }), "W");
        toast(t("toast_garage_not_found"));
        setTabIndicator("garage", "warn");
        return;
      }
      const line = data.split(/\r?\n/).find((l) => l.startsWith("PlayerDeck="));
      if (!line) { addLog(t("log_garage_no_playerdeck"), "E"); setTabIndicator("garage", "bad"); return; }
      const m = line.match(/^PlayerDeck=[^,]+,s(.+)$/);
      if (!m) { addLog(t("log_garage_parse_failed"), "E"); setTabIndicator("garage", "bad"); return; }
      // Захист від пошкодженого Garage.dat: невалідний JSON не повинен
      // кидати необроблений виняток і ламати решту сторінки.
      let cards;
      try {
        cards = JSON.parse(m[1]);
      } catch (e) {
        addLog(t("log_garage_parse_failed"), "E");
        setTabIndicator("garage", "bad");
        return;
      }
      if (!Array.isArray(cards)) { addLog(t("log_garage_parse_failed"), "E"); setTabIndicator("garage", "bad"); return; }
      // WebUI реально зчитав і розпарсив гараж — статус «готово» відтепер
      // липкий: жодні подальші stat-перевірки не скинуть його назад.
      garageEverReady = true;
      dstReady = true;

      const total = cards.length;
      const locked = cards.filter((c) => c.locked).length;
      const myCars = cards.filter((c) => c.state === 1).length;
      const battle = { w: 0, l: 0, d: 0 };
      for (const c of cards) {
        battle.w += c.cardWins || 0;
        battle.l += c.cardLosses || 0;
        battle.d += c.cardDraws || 0;
      }

      const held = total - locked;
      const battleTotal = battle.w + battle.d + battle.l;

      // Заповнення слотів (плитка з фоновим прогресом)
      const fillPct = myCars ? Math.min(100, (locked / myCars) * 100) : 0;
      // Слот-індикатор: при >95% зайнятості — жовто-помаранчеве світлодіодне
      // світіння-попередження, що слоти закінчуються.
      const garageFillProgress = $("garageFillProgress");
      const garageFillTile = document.querySelector(".garage-fill-tile");
      if (garageFillProgress) {
        garageFillProgress.style.width = fillPct + "%";
        garageFillProgress.className = "garage-fill-bar p-" + (fillPct >= 90 ? "red" : fillPct >= 75 ? "orange" : fillPct >= 50 ? "yellow" : "green");
      }
      if (garageFillTile) {
        garageFillTile.setAttribute("aria-valuenow", String(Math.round(fillPct)));
        garageFillTile.classList.toggle("slots-warn", fillPct > 95);
      }
      $("garageBarText").textContent = `${locked.toLocaleString("uk-UA")} / ${myCars.toLocaleString("uk-UA")}`;
      $("garagePctText").textContent = fmtPct(fillPct);

      // Held — яскравий тег, що одразу впадає в око (деталі — в title)
      $("garageHeldLine").innerHTML =
        `<span class="pill-held" title="${t("garage_held", { held: held.toLocaleString("uk-UA") }).replace(/"/g, "&quot;")}">🏷️ ${t("garage_held_short", { held: held.toLocaleString("uk-UA") })}</span>`;

      // Прокачка — стек-шкала (renderUpgradeBar)
      const counts = { "111": 0, "332": 0, "323": 0, "233": 0, "custom": 0 };
      for (const c of cards) counts[upgradeKey(c)]++;
      renderUpgradeBar([
        { k: "111", label: UPGRADE_LABELS["111"], color: "#3ddc84" },
        { k: "332", label: UPGRADE_LABELS["332"], color: "#4d7cff" },
        { k: "323", label: UPGRADE_LABELS["323"], color: "#a06bff" },
        { k: "233", label: UPGRADE_LABELS["233"], color: "#ff9f43" },
        { k: "custom", label: t("upg_custom"), color: "#6b7284" },
      ], counts, total);

      // Бої — шкала боїв
      $("battleBarText").textContent = battleTotal.toLocaleString("uk-UA");
      renderBattleBar(battle, battleTotal);

      $("garageEmpty").style.display = "none";
      $("garageStats").style.display = "block";
      $("garageMeta").style.display = "block";
      addLog(t("log_garage_analyzed", { total, locked, held: total - locked }));
      await loadResources();
      setTabIndicator("garage", "ok");
    } catch (e) {
      addLog(t("log_garage_analyze_error", { message: e.message }), "E");
      setTabIndicator("garage", "bad");
    } finally {
      if (loadBtn) { loadBtn.disabled = false; loadBtn.textContent = t("garage_calc_btn"); }
    }
  }

  // ---- wire up ----------------------------------------------------------
  // ---- theme (auto / light / dark) ---------------------------------------
  const systemLightMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function applyResolvedTheme(choice) {
    const resolved = choice === "auto"
      ? (systemLightMedia && systemLightMedia.matches ? "light" : "amoled")
      : choice;
    document.documentElement.setAttribute("data-theme", resolved);
  }

  function updateThemeSwitchUI(choice) {
    const switchEl = $("themeSwitch");
    if (!switchEl) return;
    switchEl.querySelectorAll(".theme-opt").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.themeChoice === choice);
    });
  }

  let currentThemeChoice = "auto";

  async function loadTheme() {
    await migrateAndRemoveCfg(THEME_FILE, CFG_KEYS.theme);
    let choice = lsGet(CFG_KEYS.theme) || "auto";
    if (!["auto", "light", "dark", "amoled"].includes(choice)) choice = "amoled";
    currentThemeChoice = choice;
    applyResolvedTheme(choice);
    updateThemeSwitchUI(choice);
  }

  async function setTheme(choice) {
    currentThemeChoice = choice;
    applyResolvedTheme(choice);
    updateThemeSwitchUI(choice);
    lsSet(CFG_KEYS.theme, choice);
  }

  function initThemeSwitch() {
    const switchEl = $("themeSwitch");
    if (!switchEl) return;
    switchEl.querySelectorAll(".theme-opt").forEach((btn) => {
      btn.addEventListener("click", () => setTheme(btn.dataset.themeChoice));
    });
    if (systemLightMedia) {
      systemLightMedia.addEventListener("change", () => {
        if (currentThemeChoice === "auto") applyResolvedTheme("auto");
      });
    }
  }

  // ---- analytics: daily snapshot history + charts + forecast -------------
  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function base64EncodeUtf8(str) {
    // v0.0.514: сучасний UTF-8 encoder через TextEncoder (раніше —
    // deprecated `unescape(encodeURIComponent(...))`).
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    // String.fromCharCode.apply — найшвидший спосіб зібрати бінарний рядок
    // для btoa без оверхеду per-char.
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  async function loadHistory() {
    if (!hasKsu()) return MOCK_HISTORY;
    // Читання з фолбеком на /data/media-дзеркало + повний try/catch:
    // пошкоджений/відсутній history.jsonl не повинен лишати таб
    // «Аналітика» у стані вічного завантаження.
    let stdout = "";
    try {
      const first = await exec(`cat ${shellQuote(HISTORY_FILE)} 2>/dev/null`);
      if (first.errno === 0 && first.stdout.trim()) {
        stdout = first.stdout;
      } else {
        const alt = await exec(`cat ${shellQuote(altPath(HISTORY_FILE))} 2>/dev/null`);
        if (alt.errno === 0 && alt.stdout.trim()) stdout = alt.stdout;
      }
    } catch (e) {
      addLog(t("log_analytics_snapshot_error", { message: String(e && e.message || e) }), "E");
      return [];
    }
    if (!stdout.trim()) return [];
    // v0.0.514: сувора схема-валідація кожного рядка перед прийняттям.
    // Захищає від «брудних» файлів (ручне редагування, битий імпорт) і від
    // можливих артефактів усіченого запису: відкидаємо рядки без валідної
    // ISO-дати або з не-скінченними числовими полями.
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const NUMERIC_FIELDS = ["cash", "gold", "prestige", "garageTotal", "garageLocked"];
    const isValidEntry = (h) => {
      if (!h || typeof h !== "object") return false;
      if (typeof h.date !== "string" || !DATE_RE.test(h.date)) return false;
      for (const k of NUMERIC_FIELDS) {
        if (h[k] == null) continue;
        if (typeof h[k] !== "number" || !Number.isFinite(h[k])) return false;
      }
      return true;
    };
    let dropped = 0;
    const out = [];
    for (const line of stdout.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let parsed = null;
      try { parsed = JSON.parse(t); } catch (e) { dropped++; continue; }
      if (!isValidEntry(parsed)) { dropped++; continue; }
      out.push(parsed);
    }
    if (dropped > 0) {
      // v0.0.514: інформуємо користувача про відкинуті рядки (без шуму —
      // тільки якщо щось реально було невалідне).
      addLog(t("log_analytics_snapshot_error", {
        message: `${dropped} invalid history line(s) skipped`
      }), "W");
    }
    return out;
  }

  async function saveHistory(history) {
    // v0.0.514 Patch B: дедуплікація за полем `date` перед записом. Захищає
    // від дублікатів днів у разі ручного редагування файлу або повторних
    // імпортів — лишаємо лише один канонічний запис на кожну дату (останній
    // запис у масиві «перебиває» попередні).
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const NUMERIC_FIELDS = ["cash", "gold", "prestige", "garageTotal", "garageLocked"];
    const isValidEntry = (h) => {
      if (!h || typeof h !== "object") return false;
      if (typeof h.date !== "string" || !DATE_RE.test(h.date)) return false;
      for (const k of NUMERIC_FIELDS) {
        if (h[k] == null) continue;
        if (typeof h[k] !== "number" || !Number.isFinite(h[k])) return false;
      }
      return true;
    };
    const byDate = {};
    for (const h of history || []) {
      if (!isValidEntry(h)) continue;
      byDate[h.date] = Object.assign(byDate[h.date] || {}, h);
    }
    const deduped = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    const content = deduped.map((h) => JSON.stringify(h)).join("\n") + (deduped.length ? "\n" : "");
    const b64 = base64EncodeUtf8(content);
    // v0.0.514 Patch A: атомарний запис через .tmp + mv. Якщо процес або
    // пристрій впаде під час base64 -d, лишиться старий файл цілим —
    // .tmp просто не буде перейменовано у фінальне ім'я.
    const tmpMain = `${HISTORY_FILE}.tmp`;
    const tmpAlt  = `${altPath(HISTORY_FILE)}.tmp`;
    const writeAtomic = async (finalPath, tmpPath) => {
      // `rm -f` на випадок, якщо .tmp лишився від попереднього збою
      // (cleanup). Потім записуємо у .tmp і атомарно перейменовуємо.
      // `chmod 0644` + `chown media_rw` щоб файл лишався доступним для
      // наступного читання з WebUI/Chrome (аналог sync_now.sh fixup).
      const r1 = await exec(
        `rm -f ${shellQuote(tmpPath)} && echo ${shellQuote(b64)} | base64 -d > ${shellQuote(tmpPath)} && chmod 0644 ${shellQuote(tmpPath)} 2>/dev/null; mv -f ${shellQuote(tmpPath)} ${shellQuote(finalPath)}`
      ).catch(() => null);
      return r1;
    };
    // Пишемо в обидва дзеркала: основний шлях і raw /data/media — щоб
    // наступне читання спрацювало незалежно від того, який із видів теки
    // доступний shell у цьому ROM. Дзеркала незалежні: збій в одному з
    // них не блокує запис у інший (best-effort).
    await writeAtomic(HISTORY_FILE, tmpMain);
    await writeAtomic(altPath(HISTORY_FILE), tmpAlt);
  }

  async function getResourceSnapshot() {
    const data = await readSourceFile(SRC_USER, SRC_USER_ROOT, DST_USER);
    if (!data) return null;
    const val = (key) => {
      const m = data.match(new RegExp(`${key}=[0-9A-F]{8},i(\\d+)`));
      return m ? Number(m[1]) : null;
    };
    return { cash: val("Cash"), gold: val("Gold"), prestige: val("FestivalPasses") };
  }

  async function getGarageSnapshot() {
    const data = await readSourceFile(SRC, SRC_ROOT, DST);
    if (!data) return null;
    const line = data.split(/\r?\n/).find((l) => l.startsWith("PlayerDeck="));
    if (!line) return null;
    const m = line.match(/^PlayerDeck=[^,]+,s(.+)$/);
    if (!m) return null;
    try {
      const cards = JSON.parse(m[1]);
      const total = cards.length;
      const locked = cards.filter((c) => c.locked).length;
      return { garageTotal: total, garageLocked: locked };
    } catch (e) {
      return null;
    }
  }

  async function recordSnapshotIfNeeded() {
    if (!hasKsu()) return;
    try {
      const [res, gar] = await Promise.all([getResourceSnapshot(), getGarageSnapshot()]);
      if (!res && !gar) return;
      const history = await loadHistory();
      const today = todayStr();
      let entry = history.find((h) => h.date === today);
      if (!entry) {
        entry = { date: today, ts: Date.now() };
        history.push(entry);
      } else {
        entry.ts = Date.now();
      }
      if (res) {
        if (res.cash != null) entry.cash = res.cash;
        if (res.gold != null) entry.gold = res.gold;
        if (res.prestige != null) entry.prestige = res.prestige;
      }
      if (gar) {
        if (gar.garageTotal != null) entry.garageTotal = gar.garageTotal;
        if (gar.garageLocked != null) entry.garageLocked = gar.garageLocked;
      }
      history.sort((a, b) => a.date.localeCompare(b.date));
      await saveHistory(history);
    } catch (e) {
      addLog(t("log_analytics_snapshot_error", { message: e.message }), "E");
    }
  }

  function fmtNum(n) {
    return n == null ? "—" : n.toLocaleString("uk-UA");
  }

  function computeDelta(history, key) {
    const withKey = history.filter((h) => h[key] != null);
    if (withKey.length < 2) return null;
    const last = withKey[withKey.length - 1];
    const lastDate = new Date(last.date + "T00:00:00");
    let prev = null;
    for (let i = withKey.length - 2; i >= 0; i--) {
      const d = new Date(withKey[i].date + "T00:00:00");
      if ((lastDate - d) / 86400000 >= 1) { prev = withKey[i]; break; }
    }
    if (!prev) return null;
    return last[key] - prev[key];
  }

  // ---- analytics: forecast range state (slider, days) -----------------
  let analyticsPeriod = 30;
  try {
    const raw = localStorage.getItem("td2tdr_an_period");
    const n = parseInt(raw, 10);
    if (!isNaN(n)) analyticsPeriod = Math.min(90, Math.max(1, n));
  } catch (e) {}
  // v0.0.511: повзунок прогнозу живе ОКРЕМО від графіків — input-handler
  // оновлює ТІЛЬКИ блок прогнозу (`updateForecastBlock`), не викликаючи
  // renderAnalytics(). Графіки за замовчуванням показують ВСЮ історію.
  // v0.0.512: дефолтний режим графіка — cumulative. Якщо localStorage
  // порожній або містить невалідне значення, режим лишається cumulative.
  let analyticsChartMode = "cumulative";
  try {
    const m = localStorage.getItem("td2tdr_an_chart_mode");
    if (m === "daily" || m === "cumulative") analyticsChartMode = m;
  } catch (e) {}
  // Останній розрахований зріз історії — кеш для ізольованого апдейту
  // прогнозу без повторного виклику renderAnalytics().
  let _analyticsLastHist = null;

  // v0.0.511: filterHistoryByPeriod видалено — графіки завжди показують
  // ВСЮ історію (від першого до останнього запису). Повзунок прогнозу не
  // впливає на графіки, лише на блок прогнозу.

  // biggest single-day-over-day gain recorded so far (all-time, not period-limited)
  function computeBestGain(history, key) {
    const withKey = history.filter((h) => h[key] != null);
    if (withKey.length < 2) return null;
    let best = -Infinity, bestDate = null;
    for (let i = 1; i < withKey.length; i++) {
      const gain = withKey[i][key] - withKey[i - 1][key];
      if (gain > best) { best = gain; bestDate = withKey[i].date; }
    }
    return best > 0 ? { gain: best, date: bestDate } : null;
  }

  // найбільший одноденний спад (витрати) за історію — «Піковий день витрат»
  function computeWorstLoss(history, key) {
    const withKey = history.filter((h) => h[key] != null);
    if (withKey.length < 2) return null;
    let worst = Infinity, worstDate = null;
    for (let i = 1; i < withKey.length; i++) {
      const delta = withKey[i][key] - withKey[i - 1][key];
      if (delta < worst) { worst = delta; worstDate = withKey[i].date; }
    }
    return worst < 0 ? { loss: -worst, date: worstDate } : null;
  }

  // v0.0.512: KPI-дашборд (renderKpi / computeAvgRateFull / computeTrend7d)
  // видалено — спрощення UI. Метрики ресурсів доступні окремо у графіках.

  // v0.0.511: сценарії (computeScenarios) видалено у v0.0.512 — блок
  // прогнозу показує лише базовий баланс на вибрану дату.

  function formatForecastDate(daysAhead) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + Number(daysAhead || 0));
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}.${mm}.${d.getFullYear()}`;
  }

  function formatShortDate(dateStr) {
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString(currentUiLang === "en" ? "en-US" : "uk-UA", { day: "numeric", month: "short" });
    } catch (e) { return dateStr; }
  }


  // v0.0.511: графік тепер підтримує ДВА режими:
  //   • "cumulative" — значення балансу на кінець кожного дня (як раніше).
  //   • "daily"      — дельта за день (perDay) між сусідніми знімками.
  // У data-points серіалізується трійка [date, value, perDay, balance]
  // щоб tooltip міг показати і зміну, і баланс незалежно від режиму.
  function buildChartSeries(history, key) {
    const points = history.filter((h) => h[key] != null);
    return points.map((p, i) => {
      const prev = i > 0 ? points[i - 1][key] : null;
      const delta = prev != null ? p[key] - prev : null;
      return { date: p.date, value: p[key], delta, balance: p[key] };
    });
  }

  function renderSparkline(history, key, color, mode) {
    const series = buildChartSeries(history, key);
    if (series.length < 2) {
      const have = series.length;
      const need = 2;
      const dots = Array.from({ length: need }, (_, i) =>
        `<span class="an-progress-dot${i < have ? " filled" : ""}"></span>`
      ).join("");
      const lastVal = have ? series[have - 1].value : null;
      return `
        <div class="an-empty an-empty-progress">
          <div class="an-progress-row">
            <div class="an-progress-dots">${dots}</div>
            <span class="an-progress-text">${t("an_days_collected", { have, need })}</span>
          </div>
          ${lastVal != null ? `<div class="an-progress-current">${t("an_first_point", { value: fmtNum(lastVal) })}</div>` : ""}
        </div>
      `;
    }
    const isDaily = mode === "daily";
    const plotValues = isDaily
      ? series.map((s) => s.delta == null ? 0 : s.delta)
      : series.map((s) => s.value);
    const min = Math.min(...plotValues);
    const max = Math.max(...plotValues);
    const range = max - min || 1;
    const W = 300, H = 60, PAD = 4;
    const stepX = (W - PAD * 2) / (series.length - 1);
    const coords = series.map((p, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - ((plotValues[i] - min) / range) * (H - PAD * 2);
      return [x, y];
    });
    const path = coords.map((c, i) => (i === 0 ? "M" : "L") + c[0].toFixed(1) + "," + c[1].toFixed(1)).join(" ");
    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaPath = `${path} L${last[0].toFixed(1)},${H - PAD} L${first[0].toFixed(1)},${H - PAD} Z`;
    // Серіалізуємо всі три поля (date / value / perDay) для tooltip'а —
    // initChartInteraction дізнається режим із DOM-класу.
    const dataPoints = escapeAttr(JSON.stringify(
      series.map((s) => [s.date, s.value, s.delta == null ? null : s.delta, s.balance])
    ));
    const zeroY = isDaily && min < 0 && max > 0
      ? H - PAD - ((0 - min) / range) * (H - PAD * 2)
      : null;
    const zeroLine = zeroY != null
      ? `<line x1="${PAD.toFixed(1)}" y1="${zeroY.toFixed(1)}" x2="${(W - PAD).toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="var(--text-dimmer)" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.6"></line>`
      : "";
    return `
      <div class="an-chart-wrap an-chart-mode-${mode}" data-mode="${mode}" data-points="${dataPoints}">
        <svg viewBox="0 0 ${W} ${H}" class="an-chart" preserveAspectRatio="none">
          ${zeroLine}
          <path d="${areaPath}" fill="${color}" opacity="0.14"></path>
          <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
          <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="${color}"></circle>
          <line class="an-chart-cursor-line" x1="0" y1="0" x2="0" y2="${H}"></line>
          <circle class="an-chart-cursor-dot" r="4" fill="${color}" stroke="#0a0a12" stroke-width="1.5"></circle>
          <rect class="an-chart-hit" x="0" y="0" width="${W}" height="${H}"></rect>
        </svg>
        <div class="an-tooltip"><b></b><span></span><em></em></div>
      </div>
    `;
  }

  function linearForecastDays(history, key, target) {
    const pts = history.filter((h) => h[key] != null).slice(-14);
    if (pts.length < 2) return null;
    const xs = pts.map((_, i) => i);
    const ys = pts.map((p) => p[key]);
    const n = xs.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumXX = xs.reduce((s, x) => s + x * x, 0);
    const denom = n * sumXX - sumX * sumX;
    if (!denom) return null;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const lastY = ys[ys.length - 1];
    if (lastY >= target) return 0;
    if (slope <= 0) return null;
    return Math.ceil((target - lastY) / slope);
  }

  // more days of history behind the forecast = more confidence in it
  function forecastConfidence(history, key) {
    const n = history.filter((h) => h[key] != null).length;
    if (n >= 7) return "high";
    if (n >= 4) return "med";
    return "low";
  }

  function renderMetric(history, key, title, color) {
    const points = history.filter((h) => h[key] != null);
    const last = points.length ? points[points.length - 1][key] : null;
    const delta = computeDelta(history, key);
    const deltaCls = delta == null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const deltaText = delta == null ? "—" : (delta > 0 ? "+" : "") + delta.toLocaleString("uk-UA");

    // v0.0.511: чіпи «7д / 30д» видалені — усі агреговані значення тепер
    // живуть у KPI-дашборді над графіками. Тут лишаємо тільки дельту за
    // останню добу (як раніше) та два довідкових рекорди.

    const best = computeBestGain(history, key);
    const recordRow = best
      ? `<div class="an-record"><span class="an-record-badge">🏆</span>${t("an_record_gain", { value: best.gain.toLocaleString("uk-UA"), date: formatShortDate(best.date) })}</div>`
      : "";

    // «Остання велика витрата» 🛍️ — довідково, останній факт списання
    // (НЕ входить у прогноз: прогноз рахується тільки від прибутку)
    const withKeyHist = history.filter((h) => h[key] != null);
    let lastSpend = null;
    for (let i = withKeyHist.length - 1; i >= 1; i--) {
      const d = withKeyHist[i][key] - withKeyHist[i - 1][key];
      if (d < 0) { lastSpend = { spend: -d, date: withKeyHist[i].date }; break; }
    }
    const lossRow = lastSpend && lastSpend.spend > 0
      ? `<div class="an-record an-record-loss"><span class="an-record-badge">🛍️</span>${t("an_record_loss", { value: lastSpend.spend.toLocaleString("uk-UA"), date: formatShortDate(lastSpend.date) })}</div>`
      : "";

    // v0.0.511: повний графік + перемикач режимів (Денні / Накопичувальний)
    const mode = analyticsChartMode;
    const isDaily = mode === "daily";
    return `
      <div class="an-metric" data-key="${escapeAttr(key)}">
        <div class="an-metric-head">
          <span class="an-metric-title">${title}</span>
          <span class="an-metric-value">${fmtNum(last)}</span>
          <span class="an-delta ${deltaCls}">${deltaText} ${t("an_delta_24h")}</span>
        </div>
        <div class="an-mode-toggle" role="tablist" aria-label="chart mode">
          <button type="button" class="an-mode-btn${!isDaily ? " active" : ""}" data-mode="cumulative" role="tab" aria-selected="${!isDaily}">${t("an_mode_cumulative")}</button>
          <button type="button" class="an-mode-btn${isDaily ? " active" : ""}" data-mode="daily" role="tab" aria-selected="${isDaily}">${t("an_mode_daily")}</button>
        </div>
        ${renderSparkline(history, key, color, mode)}
        ${recordRow}
        ${lossRow}
      </div>
    `;
  }

  // ---- analytics: tap/hold tooltip on chart points -----------------------
  // v0.0.511: tooltip тепер показує три поля (date / perDay / balance) і
  // позиціонує курсор на графіку відповідно до вибраного режиму
  // (cumulative → баланс; daily → дельта).
  function initChartInteraction() {
    const list = $("analyticsList");
    if (!list || list.dataset.chartBound) return;
    list.dataset.chartBound = "1";

    const hideAll = () => {
      list.querySelectorAll(".an-chart-wrap.hovering").forEach((w) => w.classList.remove("hovering"));
    };

    const handleMove = (e) => {
      const wrap = e.target.closest && e.target.closest(".an-chart-wrap");
      if (!wrap) return;
      const svg = wrap.querySelector(".an-chart");
      if (!svg) return;

      let points;
      try { points = JSON.parse(wrap.dataset.points); } catch (err) { return; }
      if (!points || points.length < 2) return;

      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      let frac = (clientX - rect.left) / rect.width;
      frac = Math.max(0, Math.min(1, frac));

      const idx = Math.round(frac * (points.length - 1));
      const pt = points[idx];
      const date = pt[0];
      const value = pt[1];
      const perDay = pt[2];
      const balance = pt[3];

      const mode = wrap.dataset.mode === "daily" ? "daily" : "cumulative";
      // В cumulative — курсор по value, в daily — по perDay.
      const plotValues = mode === "daily"
        ? points.map((p) => p[2] == null ? 0 : p[2])
        : points.map((p) => p[1]);
      const min = Math.min(...plotValues);
      const max = Math.max(...plotValues);
      const range = max - min || 1;
      const W = 300, H = 60, PAD = 4;
      const stepX = (W - PAD * 2) / (points.length - 1);
      const x = PAD + idx * stepX;
      const plotY = mode === "daily" ? (perDay == null ? 0 : perDay) : value;
      const y = H - PAD - ((plotY - min) / range) * (H - PAD * 2);

      const line = wrap.querySelector(".an-chart-cursor-line");
      const dot = wrap.querySelector(".an-chart-cursor-dot");
      if (line) { line.setAttribute("x1", x.toFixed(1)); line.setAttribute("x2", x.toFixed(1)); }
      if (dot) { dot.setAttribute("cx", x.toFixed(1)); dot.setAttribute("cy", y.toFixed(1)); }

      const tip = wrap.querySelector(".an-tooltip");
      if (tip) {
        tip.style.left = ((x / W) * 100) + "%";
        const b = tip.querySelector("b");
        const s = tip.querySelector("span");
        const em = tip.querySelector("em");
        if (b) b.textContent = formatShortDate(date);
        if (s) {
          // В cumulative — показуємо баланс; в daily — дельту за день.
          const head = mode === "daily"
            ? `${t("an_tooltip_delta")}: ${(perDay == null ? "—" : (perDay > 0 ? "+" : "") + perDay.toLocaleString("uk-UA"))}`
            : `${t("an_tooltip_balance")}: ${fmtNum(value)}`;
          s.textContent = head;
        }
        if (em) {
          em.textContent = mode === "daily"
            ? `${t("an_tooltip_balance")}: ${fmtNum(balance)}`
            : (perDay == null ? "" : `${t("an_tooltip_delta")}: ${(perDay > 0 ? "+" : "") + perDay.toLocaleString("uk-UA")}`);
        }
      }
      wrap.classList.add("hovering");
    };

    list.addEventListener("pointerdown", handleMove);
    list.addEventListener("pointermove", handleMove);
    list.addEventListener("pointerup", hideAll);
    list.addEventListener("pointercancel", hideAll);
    list.addEventListener("pointerleave", hideAll);
  }

  // Кількість днів збору статистики: від першого знімка до сьогодні
  // (включно). Порожня історія = 0 (стан одразу після скидання).
  function getStatDays(history) {
    if (!history.length) return 0;
    const first = new Date(history[0].date + "T00:00:00").getTime();
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.max(1, Math.floor((now.getTime() - first) / 86400000) + 1);
  }

  // v0.0.511: ізольований блок прогнозу. Викликається як при першому
  // рендері, так і при русі повзунка (без renderAnalytics).
  // Повертає HTML для всього блоку .an-forecast.
  // v0.0.512: сценарії Песиміст/Оптиміст видалено — лишаємо лише
  // прогнозований баланс і дату-орієнтир.
  function renderForecastBlockHtml(hist, days) {
    const N = Math.max(1, Math.min(90, Number(days) || 1));
    const forecastDate = formatForecastDate(N);
    const PROJ_COLORS = {
      cash: "#3ddc84", gold: "#ffb545", prestige: "#a06bff", garageSlots: "#4d7cff",
    };
    const PROJ_TITLES = {
      cash: t("an_cash"), gold: t("an_gold"),
      prestige: t("an_prestige"), garageSlots: t("an_garage"),
    };
    const rows = [];
    for (const key of ["cash", "gold", "prestige", "garageSlots"]) {
      const pts = hist.filter((h) => h[key] != null);
      if (pts.length < 2) continue;
      // Темп — як у v0.0.509: вікно 14 днів, тільки позитивні дельти.
      const winCut = Date.now() - 14 * 86400000;
      const winPts = pts.filter((p) => new Date(p.date + "T00:00:00").getTime() >= winCut);
      const ratePts = winPts.length >= 2 ? winPts : pts.slice(-2);
      let posSum = 0;
      for (let i = 1; i < ratePts.length; i++) {
        const d = ratePts[i][key] - ratePts[i - 1][key];
        if (d > 0) posSum += d;
      }
      const rFirst = ratePts[0];
      const lastPt = pts[pts.length - 1];
      const spanDays = Math.max(1, (new Date(lastPt.date) - new Date(rFirst.date)) / 86400000);
      const incomeRate = posSum / spanDays;
      if (!isFinite(incomeRate)) continue;
      const current = lastPt[key];
      const expectedDelta = Math.round(incomeRate * N);
      // v0.0.512: явна нижня межа 0 — баланс ресурсу не може бути від'ємним
      // навіть при від'ємному темпі (наприклад, якщо користувач витрачає).
      const projected = Math.max(0, Math.round(current + expectedDelta));
      const perDay = Math.round(incomeRate * 10) / 10;

      const accent = PROJ_COLORS[key] || "var(--text)";
      let rateBadge;
      if (perDay > 0) {
        rateBadge = `<small class="an-proj-net up">🟢 +${perDay.toLocaleString("uk-UA")}${t("an_per_day")}</small>`;
      } else if (perDay < 0) {
        rateBadge = `<small class="an-proj-net down">🔴 ${perDay.toLocaleString("uk-UA")}${t("an_per_day")}</small>`;
      } else {
        rateBadge = `<small class="an-proj-net flat">—${t("an_per_day")}</small>`;
      }
      rows.push(`
        <div class="an-proj-row" data-key="${escapeAttr(key)}">
          <div class="an-proj-left"><span>${PROJ_TITLES[key]}</span></div>
          <div class="an-proj-right">
            <b class="up" style="color:${accent}">${projected.toLocaleString("uk-UA")}</b>
            ${rateBadge}
          </div>
        </div>
      `);
    }
    if (!rows.length) return "";
    return `
      <div class="an-forecast an-forecast-card" data-forecast-block>
        <div class="an-proj-title">📈 ${t("an_projection", { days: N })}</div>
        <div class="an-forecast-meta">
          <div class="an-forecast-meta-item">
            <span class="an-forecast-meta-label">${t("an_forecast_period")}</span>
            <span class="an-forecast-meta-value" data-forecast-period>${N} ${t("an_per_day").trim()}</span>
          </div>
          <div class="an-forecast-meta-item an-forecast-meta-accent">
            <span class="an-forecast-meta-label">${t("an_forecast_date")}</span>
            <span class="an-forecast-meta-value" data-forecast-date>${forecastDate}</span>
          </div>
        </div>
        <div class="an-proj-grid">${rows.join("")}</div>
      </div>
    `;
  }

  // Ізольований апдейт ТІЛЬКИ блоку прогнозу (без renderAnalytics).
  // Викликається при русі повзунка. v0.0.512: KPI-дашборд видалено, тож
  // блок прогнозу — перший елемент списку.
  function updateForecastBlock() {
    if (!_analyticsLastHist) return;
    const root = $("analyticsList");
    if (!root) return;
    const old = root.querySelector("[data-forecast-block]");
    const fresh = renderForecastBlockHtml(_analyticsLastHist, analyticsPeriod);
    if (!fresh) {
      if (old) old.remove();
      return;
    }
    if (!old) {
      root.insertAdjacentHTML("afterbegin", fresh);
    } else {
      old.outerHTML = fresh;
    }
  }

  // Стиснений прогноз по престижу (старий блок an-forecast для prestige→1000)
  // лишаємо, але тепер він рендериться окремо і не залежить від слайдера.
  function renderPrestigeForecastHtml(hist) {
    const forecastDays = linearForecastDays(hist, "prestige", 1000);
    const pts = hist.filter((h) => h.prestige != null);
    const last = pts.length ? pts[pts.length - 1] : null;
    if (last && last.prestige >= 1000) {
      return `<div class="an-forecast">${t("an_forecast_max")}</div>`;
    }
    if (forecastDays != null) {
      const conf = forecastConfidence(hist, "prestige");
      const confPillCls = conf === "high" ? "pill-ok" : conf === "med" ? "pill-warn" : "pill";
      const confLabel = t(`an_forecast_conf_label_${conf}`);
      return `<div class="an-forecast">${t("an_forecast_days", { days: forecastDays })} <span class="pill ${confPillCls}" style="margin-top:6px;display:inline-block;">${confLabel}</span></div>`;
    }
    if (pts.length >= 2) {
      return `<div class="an-forecast">${t("an_forecast_flat")}</div>`;
    }
    return "";
  }

  async function renderAnalytics() {
    const container = $("analyticsList");
    if (!container) return;
    const history = await loadHistory();
    {
      const st = $("statDaysText");
      if (st) st.textContent = t("an_stat_days", { n: getStatDays(history) });
    }
    if (!history.length) {
      container.innerHTML = `<div class="garage-empty">${t("an_no_data")}</div>`;
      _analyticsLastHist = null;
      setTabIndicator("analytics", null);
      return;
    }
    setTabIndicator("analytics", history.length >= 7 ? "ok" : history.length >= 3 ? "warn" : "bad");

    // v0.0.511: ізольований біндинг повзунка прогнозу. Слайдер НЕ
    // викликає renderAnalytics — лише оновлює блок прогнозу.
    const range = $("analyticsRange");
    if (range && !range.dataset.bound) {
      range.dataset.bound = "1";
      range.min = "1";
      range.max = "90";
      range.value = String(analyticsPeriod);
      range.addEventListener("input", () => {
        analyticsPeriod = Math.max(1, Math.min(90, Number(range.value) || 1));
        const lbl = $("analyticsRangeVal");
        if (lbl) lbl.textContent = `${analyticsPeriod}д`;
        try { localStorage.setItem("td2tdr_an_period", String(analyticsPeriod)); } catch (e) {}
        updateForecastBlock();
      });
    }
    if (range) {
      range.value = String(analyticsPeriod);
      const lbl = $("analyticsRangeVal");
      if (lbl) lbl.textContent = `${analyticsPeriod}д`;
    }

    // Індикатор точності: що більше накопичених днів історії, то вищий %.
    const accEl = $("analyticsAccuracy");
    if (accEl) {
      const histDays = history.length;
      const pct = Math.min(99, Math.round(20 + 70 * Math.min(histDays, 14) / 14));
      const cls = histDays >= 7 ? "pill-ok" : histDays >= 3 ? "pill-warn" : "pill";
      accEl.innerHTML = `<span class="pill ${cls}">${t("an_accuracy", { pct })}</span>`;
    }

    const hist = history.map((h) => ({
      ...h,
      garageSlots: h.garageLocked != null ? h.garageLocked : h.garageTotal,
    }));
    // Кешуємо для updateForecastBlock.
    _analyticsLastHist = hist;

    let html = "";
    // v0.0.512: KPI-дашборд видалено — блок прогнозу тепер найвищий.
    html += renderForecastBlockHtml(hist, analyticsPeriod);
    // 4 ресурсні графіки з повною історією.
    html += renderMetric(hist, "cash", t("an_cash"), "#3ddc84");
    html += renderMetric(hist, "gold", t("an_gold"), "#ffb545");
    html += renderMetric(hist, "prestige", t("an_prestige"), "#a06bff");
    html += renderMetric(hist, "garageSlots", t("an_garage"), "#4d7cff");
    // Стиснений прогноз по престижу → 1000 — найнижче.
    const forecastHtml = renderPrestigeForecastHtml(history);

    container.innerHTML = html + forecastHtml;
    initChartInteraction();
    bindChartModeToggles();
  }

  // v0.0.511: перемикач режимів графіка (Денні / Накопичувальний).
  // Делегований обробник на контейнері — працює після кожного re-render.
  function bindChartModeToggles() {
    const list = $("analyticsList");
    if (!list || list.dataset.modeBound) return;
    list.dataset.modeBound = "1";
    list.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest(".an-mode-btn");
      if (!btn) return;
      const newMode = btn.dataset.mode === "daily" ? "daily" : "cumulative";
      if (newMode === analyticsChartMode) return;
      analyticsChartMode = newMode;
      try { localStorage.setItem("td2tdr_an_chart_mode", newMode); } catch (err) {}
      // Перемальовуємо ТІЛЬКИ графіки — без renderAnalytics.
      list.querySelectorAll(".an-mode-btn").forEach((b) => {
        const on = b.dataset.mode === newMode;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      list.querySelectorAll(".an-metric").forEach((metricEl) => {
        const key = metricEl.dataset.key;
        if (!key) return;
        const color = ({
          cash: "#3ddc84", gold: "#ffb545", prestige: "#a06bff", garageSlots: "#4d7cff"
        })[key] || "var(--accent)";
        const wrap = metricEl.querySelector(".an-chart-wrap");
        if (!wrap) return;
        const fresh = renderSparkline(_analyticsLastHist || [], key, color, newMode);
        const tmp = document.createElement("div");
        tmp.innerHTML = fresh;
        const newWrap = tmp.firstElementChild;
        if (newWrap) wrap.replaceWith(newWrap);
      });
    });
  }

  // ---- changelog ----------------------------------------------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function parseChangelog(md) {
    const lines = md.replace(/\r/g, "").split("\n");
    const versions = [];
    let current = null;
    for (const line of lines) {
      const verMatch = line.match(/^#\s+(.+)/);
      if (verMatch) {
        current = { title: verMatch[1].trim(), items: [] };
        versions.push(current);
        continue;
      }
      if (!current) continue;
      const subMatch = line.match(/^\s{2,}-\s+(.+)/);
      const topMatch = line.match(/^-\s+(.+)/);
      if (subMatch && current.items.length) {
        const last = current.items[current.items.length - 1];
        last.sub = last.sub || [];
        last.sub.push(subMatch[1].trim());
      } else if (topMatch) {
        current.items.push({ text: topMatch[1].trim() });
      }
    }
    return versions;
  }

  function renderChangelog(versions) {
    if (!versions.length) return `<div class="garage-empty">${t("cl_empty")}</div>`;
    return versions.map((v, idx) => {
      const isLatest = idx === 0;
      const itemsHtml = v.items.map((it) => {
        const subHtml = it.sub && it.sub.length
          ? `<ul class="cl-sub">${it.sub.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
          : "";
        return `<li>${escapeHtml(it.text)}${subHtml}</li>`;
      }).join("");
      return `
        <div class="cl-entry${isLatest ? " cl-latest expanded" : ""}">
          <div class="cl-head">
            <span class="cl-badge">${isLatest ? t("cl_current") : t("cl_archive")}</span>
            <span class="cl-version">${escapeHtml(v.title)}</span>
            <svg class="cl-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <div class="cl-body"><ul class="cl-list">${itemsHtml}</ul></div>
        </div>
      `;
    }).join("");
  }

  // Локальний fallback: якщо changelog.md відсутній у білді/недоступний,
  // «Історія версій» все одно показує останні зміни замість помилки.
  const CHANGELOG_FALLBACK = `# v0.0.501
- Синхронізація: миттєвий статус із кешу, копіювання тільки за кнопкою
- Гараж: контрастні картки, donut прокачки, LED-попередження слотів, тег Held
- Аналітика: прогнозний слайдер 3–90 дн., середньодобовий приріст, точність прогнозу
- Оптимізація: зачистка коду та розміру модуля`;

  async function loadChangelog() {
    const container = $("changelogList");
    if (!container) return;
    if (!hasKsu()) {
      container.innerHTML = `<div class="garage-empty">${t("an_no_access")}</div>`;
      return;
    }
    try {
      const { errno, stdout } = await exec(`cat ${shellQuote(MODDIR + "/changelog.md")} 2>/dev/null`);
      let md = stdout || "";
      if (errno !== 0 || !md.trim()) {
        // Fallback: вшитий текст останніх змін — вікно більше не ламається
        addLog(t("cl_load_error"), "W");
        md = CHANGELOG_FALLBACK;
      }
      const versions = parseChangelog(md);
      container.innerHTML = renderChangelog(versions);
      container.querySelectorAll(".cl-entry").forEach((entry) => {
        const head = entry.querySelector(".cl-head");
        if (head) head.addEventListener("click", () => entry.classList.toggle("expanded"));
      });
    } catch (e) {
      const versions = parseChangelog(CHANGELOG_FALLBACK);
      container.innerHTML = renderChangelog(versions);
    }
  }

  // ---- update check (badge on the "!" button + card in the changelog modal) --
  const UPDATE_JSON_URL = "https://raw.githubusercontent.com/sansej8989/td2tdr/master/update.json";

  async function checkForUpdate() {
    const badge = $("updateBadge");
    const card = $("updateCard");
    if (!card) return;

    let installedCode = null;
    let installedVersion = null;
    if (hasKsu()) {
      try {
        const { errno, stdout } = await exec(`grep -E '^version(Code)?=' ${shellQuote(MODDIR + "/module.prop")} 2>/dev/null`);
        if (errno === 0) {
          stdout.split("\n").forEach((line) => {
            const m = line.match(/^version=(.+)$/);
            const mc = line.match(/^versionCode=(\d+)$/);
            if (m) installedVersion = m[1].trim();
            if (mc) installedCode = parseInt(mc[1], 10);
          });
        }
      } catch (e) {}
    }

    card.hidden = false;
    card.innerHTML = `<div class="update-card-status">${t("upd_checking")}</div>`;

    let remote;
    try {
      const res = await fetch(UPDATE_JSON_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      remote = await res.json();
    } catch (e) {
      card.innerHTML = `<div class="update-card-status">${t("upd_unavailable")}</div>`;
      return;
    }

    const remoteCode = Number(remote.versionCode);
    const updateAvailable = Number.isFinite(installedCode) && Number.isFinite(remoteCode)
      ? remoteCode > installedCode
      : false;

    const installedLabel = installedVersion
      ? t("upd_installed", { version: installedVersion })
      : "";

    if (!updateAvailable) {
      card.innerHTML = `
        <div class="update-card-row">
          <span class="update-card-installed">${installedLabel}</span>
          <span class="update-card-status">
            <span class="flow-dot ok" style="width:8px;height:8px;"></span>
            ${t("upd_latest")}
          </span>
        </div>`;
      if (badge) badge.hidden = true;
      return;
    }

    card.innerHTML = `
      <div class="update-card-row">
        <span class="update-card-installed">${installedLabel}</span>
        <span class="pill pill-warn">${t("upd_available")} · v${escapeHtml(String(remote.version || remoteCode))}</span>
      </div>
      <div class="update-card-actions">
        <button id="updateInstallBtn" class="btn-icon btn-text btn-accent" style="text-decoration:none;">${t("upd_open")}</button>
      </div>`;
    if (badge) badge.hidden = false;

    // Реальна установка: завантаження zip → перевірка SHA-256 → встановлення
    // через менеджер модулів (magisk --install-module / ksud module install).
    const installBtn = $("updateInstallBtn");
    if (installBtn) installBtn.addEventListener("click", async () => {
      if (!hasKsu()) { toast(t("log_sync_unavailable_demo")); return; }
      if (installBtn.disabled) return;
      installBtn.disabled = true;
      installBtn.classList.add("spinning");
      installBtn.textContent = t("upd_installing");

      const overlay = document.createElement("div");
      overlay.className = "install-overlay";
      overlay.innerHTML = `
        <div class="install-card">
          <div class="install-title">⬇️ ${t("upd_installing")}</div>
          <div class="install-bar"><div class="install-bar-fill"></div></div>
          <div class="install-log" id="installLog"></div>
        </div>`;
      document.body.appendChild(overlay);
      wireModalClose(overlay);
      const ilog = (msg) => {
        const box = overlay.querySelector("#installLog");
        if (box) {
          const line = document.createElement("div");
          line.className = "install-log-line";
          line.textContent = msg;
          box.appendChild(line);
          box.scrollTop = box.scrollHeight;
        }
      };
      const setBar = (pct) => {
        const f = overlay.querySelector(".install-bar-fill");
        if (f) f.style.width = Math.min(100, Math.max(0, pct)) + "%";
      };

      let ok = false;
      try {
        ilog(t("upd_dl"));
        setBar(15);
        const dl = await exec(
          `curl -L --fail -s -o /data/local/tmp/td2tdr_update.zip ${shellQuote(remote.zipUrl)} && stat -c %s /data/local/tmp/td2tdr_update.zip`
        );
        if (dl.errno !== 0 || !Number(dl.stdout.trim())) throw new Error("download failed");
        ilog(t("upd_verify"));
        setBar(45);
        if (remote.sha256) {
          const sh = await exec(`sha256sum /data/local/tmp/td2tdr_update.zip 2>/dev/null`);
          if (sh.errno === 0 && !sh.stdout.toLowerCase().startsWith(String(remote.sha256).toLowerCase())) {
            throw new Error("sha256 mismatch");
          }
        }
        ilog(t("upd_installing_module"));
        setBar(70);
        // v0.0.513: визначаємо, який root-менеджер доступний (magisk / ksud /
        // apd) і використовуємо ВІДРАЗУ його команду, без «провального
        // magisk → fallback на ksud» (це й спричиняло «magisk: inaccessible
        // or not found» на KSU/APatch у попередніх версіях).
        //   magisk --install-module <zip>
        //   ksud module install <zip>   (KernelSU / KernelSU-Next)
        //   apd module install <zip>    (APatch)
        const ZIP = "/data/local/tmp/td2tdr_update.zip";
        // POSIX-сумісний probe через `[ -x PATH ]` — працює в мінімальних
        // shell-середовищах Magisk/KSU/APatch (де `command -v` може бути
        // недоступним). Перевіряємо і канонічні шляхи, і `which`.
        const probe = await exec(
          "su -c 'if [ -x /data/adb/magisk/magisk ] || [ -x /sbin/magisk ] || which magisk >/dev/null 2>&1; then echo MAGISK; " +
          "elif [ -x /data/adb/ksud ] || which ksud >/dev/null 2>&1; then echo KSUD; " +
          "elif [ -x /data/adb/ap/bin/apd ] || [ -x /sbin/apd ] || which apd >/dev/null 2>&1; then echo APDATCH; " +
          "else echo NONE; fi' 2>&1"
        );
        const which = String(probe.stdout || "").trim().toUpperCase();
        let installCmd;
        if (which === "MAGISK") {
          installCmd = `su -c 'magisk --install-module ${shellQuote(ZIP)}' 2>&1`;
        } else if (which === "KSUD") {
          installCmd = `su -c 'ksud module install ${shellQuote(ZIP)}' 2>&1`;
        } else if (which === "APDATCH") {
          installCmd = `su -c 'apd module install ${shellQuote(ZIP)}' 2>&1`;
        } else {
          // Невідомий root-менеджер — явна помилка (НЕ викликаємо magisk
          // «на удачу», щоб не отримати «magisk: inaccessible or not found»
          // у stdout).
          setBar(100);
          throw new Error("Unknown root manager: none of {magisk, ksud, apd} found in $PATH");
        }
        const inst = await exec(installCmd);
        setBar(100);
        if (inst.errno !== 0 || /failed|error/i.test(inst.stdout + inst.stderr)) {
          throw new Error((inst.stderr || inst.stdout || "install failed").trim().slice(0, 200));
        }
        ok = true;
        ilog(t("upd_done"));
        overlay.querySelector(".install-title").textContent = "✅ " + t("upd_done");
        overlay.querySelector(".install-card").classList.add("done");
        toast(t("upd_done_reboot"));
        addLog(t("upd_done_reboot"));
      } catch (e) {
        ilog("❌ " + String(e && e.message || e));
        overlay.querySelector(".install-title").textContent = "❌ " + t("toast_sync_failed");
        overlay.querySelector(".install-card").classList.add("error");
        addLog(t("log_sync_error", { reason: String(e && e.message || e) }), "E");
      }
      setTimeout(() => overlay.remove(), ok ? 6000 : 10000);
      installBtn.classList.remove("spinning");
      installBtn.disabled = false;
      installBtn.textContent = ok ? t("upd_done_short") : t("upd_open");
    });
    if (badge) badge.hidden = false;
  }

  // ---- shared modal open/close (all 3 modals: settings/changelog/sync) ---
  // Handles: click the backdrop to close, Escape (desktop), and the Android
  // back button — WebViews route hardware/gesture back through the same
  // browser history the JS controls, so pushing a state when a modal opens
  // and closing it on popstate is what makes back-to-close actually work.
  let openModalId = null;

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    if (openModalId && openModalId !== id) closeModal(openModalId, { skipHistory: true });
    el.style.display = "flex";
    openModalId = id;
    try { history.pushState({ modal: id }, ""); } catch (e) {}
  }

  function closeModal(id, opts) {
    const el = $(id);
    if (!el) return;
    el.style.display = "none";
    if (openModalId === id) openModalId = null;
    if (!(opts && opts.skipHistory) && history.state && history.state.modal === id) {
      try { history.back(); } catch (e) {}
    }
  }


  document.addEventListener("DOMContentLoaded", () => {
    window.addEventListener("popstate", () => {
      if (openModalId) closeModal(openModalId, { skipHistory: true });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && openModalId) closeModal(openModalId);
    });
    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal(overlay.id);
      });
    });
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
    });

    setTabIndicator("log", "ok"); // logging is alive from the moment the page loads
    window.addEventListener("error", (e) => addLog(t("log_js_error", { message: e.message }), "E"));
    window.addEventListener("unhandledrejection", (e) => addLog(t("log_js_unhandled", { reason: e.reason }), "E"));

    ensureDataDir();
    // Одноразова міграція конфігів у localStorage + зачистка дрібних файлів
    // locale / theme / ui_lang із папки td2tdr_sync (залишаються лише
    // Garage.dat, user.dat та history.jsonl).
    if (hasKsu()) {
      migrateGameLocale().then(() => {
        migrateAndRemoveCfg(THEME_FILE, CFG_KEYS.theme);
        migrateAndRemoveCfg(UI_LANG_FILE, CFG_KEYS.ui_lang);
      }).catch(() => {});
    }
    applyI18n();
    initUiLangSwitch();
    loadUiLang();

    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", refreshAll);

    // ---- tab navigation ----
    const tabNav = $("tabNav");
    if (tabNav) {
      const tabBtns = Array.from(tabNav.querySelectorAll(".tab-btn"));
      const panels = Array.from(document.querySelectorAll(".tab-panel"));
      const activateTab = (name) => {
        tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
        panels.forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
        try { localStorage.setItem("td2tdr_tab", name); } catch (e) {}
      };
      tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => activateTab(btn.dataset.tab));
      });
      let savedTab = "sync";
      try { savedTab = localStorage.getItem("td2tdr_tab") || "sync"; } catch (e) {}
      if (tabBtns.some((b) => b.dataset.tab === savedTab)) activateTab(savedTab);
    }

    const loadGarage = $("loadGarage");
    if (loadGarage) loadGarage.addEventListener("click", loadGarageStats);

    const syncAndOpen = $("syncAndOpen");
    if (syncAndOpen) syncAndOpen.addEventListener("click", async () => {
      // СПРОЩЕНА ЛОГІКА: жодних модалок і перевірок файлової системи, які
      // фейляться через обмеження Android/FUSE. Кнопка лише:
      //   1) запускає фонову синхронізацію (fire-and-forget, не блокує);
      //   2) ОДРАЗУ відкриває сайт — дані гаража вже зчитані WebUI.
      syncAndOpen.classList.remove("validate", "error");
      syncAndOpen.classList.add("onclic");

      // Фонова синхронізація без очікування: оновить файл і статус сам,
      // поки користувач переходить у браузер. Жодних блокувань переходу.
      if (hasKsu()) {
        syncFile().then(() => refresh()).catch(() => {});
      }

      const opened = await openUrl("https://www.topdrivesrecords.com/me");
      syncAndOpen.classList.remove("onclic");
      if (opened) {
        syncAndOpen.classList.add("validate");
        setTimeout(() => syncAndOpen.classList.remove("validate"), 1250);
        toast(t("toast_synced"));
      } else {
        // Реальна помилка — тільки якщо система не змогла відкрити браузер
        syncAndOpen.classList.add("error");
        setTimeout(() => syncAndOpen.classList.remove("error"), 2500);
      }
    });

    const closeSyncModal = $("closeSyncModal");
    if (closeSyncModal) closeSyncModal.addEventListener("click", () => closeModal("syncModal"));

    const downloadLog = $("downloadLog");
    if (downloadLog) downloadLog.addEventListener("click", () => {
      toast(t("toast_log_saved", { path: LOG_FILE }));
      addLog(t("log_log_saved", { path: LOG_FILE }));
    });

    const sendLog = $("sendLog");
    if (sendLog) sendLog.addEventListener("click", async () => {
      const endpoint = prompt(t("prompt_log_endpoint"));
      if (!endpoint) return;
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ log: sessionLog }),
        });
        alert(t("alert_log_sent"));
      } catch (e) {
        alert(t("alert_log_send_failed", { message: e.message }));
      }
    });

    // status icon: click to reveal source/copy/result details
    const statusIcon = $("statusIcon");
    const syncFlow = $("syncFlow");
    if (statusIcon && syncFlow) {
      statusIcon.addEventListener("click", () => syncFlow.classList.toggle("open"));
    }

    // changelog modal (opened via the "!" hazard button, overlays everything like settings)
    const changelogBtn = $("changelogBtn");
    if (changelogBtn) changelogBtn.addEventListener("click", () => openModal("changelogModal"));
    const closeChangelog = $("closeChangelog");
    if (closeChangelog) closeChangelog.addEventListener("click", () => closeModal("changelogModal"));

    // Settings modal (display-only — kept for future real path support)
    const settingsBtn = $("settingsBtn");
    if (settingsBtn) settingsBtn.addEventListener("click", () => openModal("settingsModal"));
    const closeSettings = $("closeSettings");
    if (closeSettings) closeSettings.addEventListener("click", () => closeModal("settingsModal"));

    const defaultSettings = $("defaultSettings");
    if (defaultSettings) defaultSettings.addEventListener("click", () => {
      localStorage.setItem("td2tdr_settings", JSON.stringify({ src: SRC, dst: DST_DIR }));
      loadSettings();
    });

    const saveSettings = $("saveSettings");
    if (saveSettings) saveSettings.addEventListener("click", () => {
      closeModal("settingsModal");
      toast(t("toast_path_fixed"));
    });

    // diagnose locale button
    const diagnoseBtn = $("diagnoseBtn");
    if (diagnoseBtn) diagnoseBtn.addEventListener("click", diagnoseLocale);

    // language selector
    initLangDropdown();
    queryActiveLocale().then((loc) => {
      selectedLocale = LANGS.some((l) => l.value === loc) ? loc : "";
      renderLangUI();
    });
    const saveLangBtn = $("saveLangBtn");
    if (saveLangBtn) saveLangBtn.addEventListener("click", applyLocale);

    loadSettings();
    loadChangelog();
    checkForUpdate();
    initThemeSwitch();
    loadTheme();

    // Старт WebUI: стан малюється МИТТЄВО з локального кешу (розмір/дата
    // останньої синхронізації), без «Не завантажено» і без очікування shell.
    // Повторне читання/копіювання — виключно за кнопкою «Синхронізувати та
    // відкрити» або «Оновити» (refreshBtn).
    const cached = paintCachedState();
    {
      const gateBtn = $("syncAndOpen");
      if (gateBtn && hasKsu() && !cached) {
        // Кешу немає (перший запуск) — кнопка чекає першої синхронізації,
        // яку користувач запускає сам натисканням.
        gateBtn.disabled = true;
        gateBtn.title = t("btn_wait_sync");
      }
    }

    // Гараж/Аналітика читають уже синхронізовану копію (read-only, без
    // копіювання) і заповнюють свої таби асинхронно.
    loadGarageStats();
    recordSnapshotIfNeeded()
      .then(renderAnalytics)
      .catch((e) => {
        // Захист від «вічного завантаження»: будь-яка помилка аналітики
        // показує повідомлення в табі, а не крутить спінер назавжди.
        addLog(t("log_analytics_snapshot_error", { message: String(e && e.message || e) }), "E");
        const list = $("analyticsList");
        if (list) list.innerHTML = `<div class="garage-empty">${t("an_load_error")}</div>`;
      });

    const logClear = $("logClear");
    if (logClear) logClear.addEventListener("click", () => {
      const el = $("log");
      if (el) el.innerHTML = "";
      sessionLog.length = 0;
      addLog(t("log_console_cleared"));
    });

    const logFilter = $("logLevelFilter");
    if (logFilter) logFilter.addEventListener("change", () => {
      const val = logFilter.value;
      const el = $("log");
      if (!el) return;
      el.querySelectorAll(".log-line").forEach((d) => {
        if (val === "all") { d.style.display = ""; return; }
        d.style.display = d.dataset.level === val ? "" : "none";
      });
    });

    // ---- Експорт / Імпорт бекапу історії аналітики -----------------------
    const anExportBtn = $("anExportBtn");
    if (anExportBtn) anExportBtn.addEventListener("click", async () => {
      if (!hasKsu()) { toast(t("log_sync_unavailable_demo")); return; }
      const history = await loadHistory();
      if (!history.length) { toast(t("an_stat_days", { n: 0 })); return; }
      const content = history.map((h) => JSON.stringify(h)).join("\n") + "\n";
      const b64 = base64EncodeUtf8(content);
      const fname = `td2tdr_history_${new Date().toISOString().slice(0, 10)}.jsonl`;
      const dest = `/sdcard/Download/${fname}`;
      const r = await exec(`echo ${shellQuote(b64)} | base64 -d > ${shellQuote(dest)}`);
      if (r.errno === 0) {
        toast(t("toast_log_saved", { path: dest }));
        addLog(t("log_log_saved", { path: dest }));
      } else {
        addLog(t("log_sync_error", { reason: "export failed" }), "E");
      }
    });

    const anImportInput = $("anImportInput");
    if (anImportInput) anImportInput.addEventListener("change", async () => {
      const file = anImportInput.files && anImportInput[0];
      anImportInput.value = "";
      if (!file || !hasKsu()) return;
      let imported = [];
      try {
        const text = await file.text();
        // Підтримка JSONL (по рядку на запис) та масиву JSON
        if (text.trim().startsWith("[")) {
          imported = JSON.parse(text);
        } else {
          imported = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
            .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
            .filter(Boolean);
        }
      } catch (e) {
        toast(t("an_imp_error"));
        return;
      }
      imported = imported.filter((h) => h && typeof h.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.date));
      if (!imported.length) { toast(t("an_imp_error")); return; }

      // Модальне підтвердження: об'єднати чи перезаписати
      const overlay = document.createElement("div");
      overlay.className = "install-overlay";
      overlay.innerHTML = `
        <div class="install-card">
          <div class="install-title">📤 ${t("an_import")}</div>
          <div class="install-reset-text">${t("an_imp_found", { n: imported.length })}</div>
          <div class="install-reset-actions">
            <button class="btn-icon btn-text" id="impCancel">${t("an_cancel")}</button>
            <button class="btn-icon btn-text" id="impMerge">${t("an_imp_merge")}</button>
            <button class="btn-icon btn-text install-reset-confirm" id="impOverwrite">${t("an_imp_overwrite")}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      wireModalClose(overlay);

      const doImport = async (mode) => {
        overlay.remove();
        const current = mode === "overwrite" ? [] : await loadHistory();
        const byDate = {};
        for (const h of current) byDate[h.date] = h;
        for (const h of imported) byDate[h.date] = Object.assign(byDate[h.date] || {}, h);
        const merged = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
        await saveHistory(merged);
        await renderAnalytics();
        addLog(t("log_analytics_history_cleared").replace(/.*/, t("an_imp_done", { n: merged.length })));
        renderAnalytics();
      };
      overlay.querySelector("#impCancel").addEventListener("click", () => overlay.remove());
      overlay.querySelector("#impMerge").addEventListener("click", () => doImport("merge"));
      overlay.querySelector("#impOverwrite").addEventListener("click", () => doImport("overwrite"));
    });

    // ---- Перемикач вікна доходу видалено у v0.0.509: один надійний
    // розрахунок по останніх 14 днях (див. коментар у renderAnalytics).

    const clearHistoryBtn = $("clearHistoryBtn");
    if (clearHistoryBtn) clearHistoryBtn.addEventListener("click", async () => {
      if (!hasKsu()) return;
      // НЕ очищаємо миттєво — спершу рахуємо період збору і показуємо
      // модальне вікно підтвердження зі стилем інсталятора.
      const history = await loadHistory();
      const n = getStatDays(history);
      const firstDate = history.length ? history[0].date : null;

      const overlay = document.createElement("div");
      overlay.className = "install-overlay";
      overlay.innerHTML = `
        <div class="install-card">
          <div class="install-title">🗑️ ${t("an_reset_title")}</div>
          <div class="install-reset-text">${t("an_reset_text", {
            n,
            date: firstDate ? formatShortDate(firstDate) : t("an_stat_days", { n: 0 }).replace(/.*: /, ""),
          })}</div>
          <div class="install-reset-actions">
            <button class="btn-icon btn-text" id="resetCancel">${t("an_cancel")}</button>
            <button class="btn-icon btn-text install-reset-confirm" id="resetConfirm">${t("an_reset_confirm")}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      wireModalClose(overlay);

      const close = () => overlay.remove();
      overlay.querySelector("#resetCancel").addEventListener("click", close);
      overlay.querySelector("#resetConfirm").addEventListener("click", async () => {
        await exec(`rm -f ${shellQuote(HISTORY_FILE)} ${shellQuote(altPath(HISTORY_FILE))}`);
        // Скидаємо лічильник на 0 та оновлюємо графіки/прогноз
        const st = $("statDaysText");
        if (st) st.textContent = t("an_stat_days", { n: 0 });
        addLog(t("log_analytics_history_cleared"));
        renderAnalytics();
        close();
      });
    });
    // Автооновлення вимкнено: стан малюється з кешу миттєво, а актуалізація
    // відбувається за кнопками «Оновити» / «Синхронізувати та відкрити» —
    // без фонових shell-викликів, що створювали відчуття «перезавантаження».
  });
})();
