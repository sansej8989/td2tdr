(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const MODDIR = "/data/adb/modules/td2tdr_sync";
  const SRC = "/storage/emulated/0/Android/data/com.hutchgames.cccg/files/Garage.dat";
  const SRC_USER = "/storage/emulated/0/Android/data/com.hutchgames.cccg/files/user.dat";
  const DST_DIR = "/storage/emulated/0/Download/td2tdr_sync";
  const DST = `${DST_DIR}/Garage.dat`;
  const DST_USER = `${DST_DIR}/user.dat`;
  const LOG = `${MODDIR}/sync.log`;
  const LANG_FILE = `${MODDIR}/locale`;
  const THEME_FILE = `${MODDIR}/theme`;
  const HISTORY_FILE = `${MODDIR}/history.jsonl`;
  const UI_LANG_FILE = `${MODDIR}/ui_lang`;

  // ---- ksu bridge -----------------------------------------------------
  let seq = 0;
  function cbName(prefix) {
    return `${prefix}_callback_${Date.now()}_${seq++}`;
  }

  function hasKsu() {
    return typeof window.ksu !== "undefined" && typeof ksu.exec === "function";
  }

  function exec(cmd) {
    return new Promise((resolve, reject) => {
      if (!hasKsu()) {
        reject(new Error("ksu bridge недоступний (відкрито не через менеджер?)"));
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
        reject(err);
      }
    });
  }

  function toast(msg) {
    try { if (hasKsu() && typeof ksu.toast === "function") ksu.toast(msg); } catch (e) {}
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
      status_dash: "—",
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
      status_synced: "Синхронізовано · {size}",
      status_size_mismatch: "Розбіжність розміру: джерело {src}, копія {dst}",
      status_no_garage: "Garage.dat гри не знайдено",
      status_no_copy: "Копії ще немає — натисніть «Синхронізувати та відкрити»",
      last_sync_label: "Остання синхронізація:",
      tab_sync: "Синхр.",
      tab_lang: "Мова",
      tab_garage: "Гараж",
      tab_log: "Журнал",
      tab_changelog: "Реліз",
      tab_analytics: "Аналіт.",
      sync_title: "Синхронізація та відкриття",
      sync_hint: "Скопіює Garage.dat і відкриє topdrivesrecords.com у системному браузері",
      lbl_open: "ВІДКРИТИ",
      lbl_sync: "СИНХРОНІЗУВАТИ",
      lbl_done: "✓ ГОТОВО",
      lang_title: "Мова гри",
      lang_system: "Системна мова",
      lang_hint: "Оберіть мову зі списку та натисніть дискету — гра перезапуститься автоматично",
      res_title: "Ресурси",
      res_empty: "Синхронізуйте файли, щоб побачити ресурси",
      res_prestige: "Престиж",
      garage_title: "Гараж",
      garage_calc_btn: "Порахувати",
      garage_analyzing: "Аналіз…",
      garage_empty: "Натисніть «Порахувати», щоб проаналізувати синхронізовану копію Garage.dat",
      garage_slots: "слотів у гаражі",
      garage_fill: "Заповнення",
      garage_upgrade: "Прокачка",
      garage_battles: "Бої",
      garage_held: "Held: {held} — для прокачки або продажу",
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
      cl_empty: "Порожній changelog",
      an_title: "Динаміка",
      an_clear: "Очистити",
      an_hint: "Знімок стану записується автоматично раз на добу — при відкритті WebUI, якщо дані вже синхронізовані",
      an_no_access: "Недоступно без root-доступу",
      an_no_data: "Дані ще не зібрані. Синхронізуйте гру хоча б раз — знімок запишеться автоматично.",
      an_not_enough: "Замало даних — потрібно 2+ дні спостережень",
      an_cash: "Cash",
      an_gold: "Gold",
      an_prestige: "Престиж",
      an_garage: "Гараж (слотів)",
      an_delta_24h: "/ 24г",
      an_forecast_max: "🏆 Престиж вже на максимумі (1000) — не забудьте його витратити.",
      an_forecast_days: "📈 За поточним темпом до <b>1000 престижу</b> залишилось приблизно <b>{days} дн.</b> Це груба оцінка на основі останніх днів, не гарантія.",
      an_forecast_flat: "📉 Темп зростання престижу зараз не додатний — прогноз побудувати не вдалося.",
      settings_title: "Налаштування",
      settings_theme: "Тема",
      theme_auto: "Авто",
      theme_light: "Світла",
      theme_dark: "Темна",
      settings_ui_lang: "Мова інтерфейсу",
      ui_lang_auto: "Авто",
      ui_lang_uk: "UKR",
      ui_lang_en: "ENG",
      settings_src_path: "Шлях джерела",
      settings_dst_path: "Шлях копії",
      settings_not_selected: "Не вибрано",
      settings_default: "За замовч.",
      settings_save: "Зберегти",
      settings_close: "Закрити",
    },
    en: {
      head_sub: "Garage Sync — manual update, local data",
      status_label: "Sync status",
      status_no_ksu: "No ksu access (open via the manager app)",
      status_no_access: "No access",
      status_dash: "—",
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
      status_synced: "Synced · {size}",
      status_size_mismatch: "Size mismatch: source {src}, copy {dst}",
      status_no_garage: "Game's Garage.dat not found",
      status_no_copy: "No copy yet — tap “Sync & open”",
      last_sync_label: "Last sync:",
      tab_sync: "Sync",
      tab_lang: "Lang",
      tab_garage: "Garage",
      tab_log: "Log",
      tab_changelog: "Release",
      tab_analytics: "Stats",
      sync_title: "Sync & open",
      sync_hint: "Copies Garage.dat and opens topdrivesrecords.com in the system browser",
      lbl_open: "OPEN",
      lbl_sync: "SYNC",
      lbl_done: "✓ DONE",
      lang_title: "Game language",
      lang_system: "System language",
      lang_hint: "Pick a language and tap the save icon — the game restarts automatically",
      res_title: "Resources",
      res_empty: "Sync the files to see resources",
      res_prestige: "Prestige",
      garage_title: "Garage",
      garage_calc_btn: "Calculate",
      garage_analyzing: "Analyzing…",
      garage_empty: "Tap “Calculate” to analyze the synced Garage.dat copy",
      garage_slots: "garage slots",
      garage_fill: "Fill",
      garage_upgrade: "Upgrades",
      garage_battles: "Battles",
      garage_held: "Held: {held} — for upgrading or selling",
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
      cl_empty: "Changelog is empty",
      an_title: "Trends",
      an_clear: "Clear",
      an_hint: "A daily snapshot is recorded automatically when you open the WebUI, if data is already synced",
      an_no_access: "Unavailable without root access",
      an_no_data: "No data yet. Sync the game at least once — a snapshot will be recorded automatically.",
      an_not_enough: "Not enough data yet — need 2+ days of history",
      an_cash: "Cash",
      an_gold: "Gold",
      an_prestige: "Prestige",
      an_garage: "Garage (slots)",
      an_delta_24h: "/ 24h",
      an_forecast_max: "🏆 Prestige is already maxed (1000) — don't forget to spend it.",
      an_forecast_days: "📈 At the current pace, reaching <b>1000 prestige</b> will take roughly <b>{days} days</b>. This is a rough estimate, not a guarantee.",
      an_forecast_flat: "📉 Prestige isn't trending upward right now — couldn't build a forecast.",
      settings_title: "Settings",
      settings_theme: "Theme",
      theme_auto: "Auto",
      theme_light: "Light",
      theme_dark: "Dark",
      settings_ui_lang: "Interface language",
      ui_lang_auto: "Auto",
      ui_lang_uk: "UKR",
      ui_lang_en: "ENG",
      settings_src_path: "Source path",
      settings_dst_path: "Copy path",
      settings_not_selected: "Not selected",
      settings_default: "Default",
      settings_save: "Save",
      settings_close: "Close",
    },
  };

  let currentUiLang = "uk";

  function t(key, vars) {
    const dict = I18N[currentUiLang] || I18N.uk;
    let str = dict[key] != null ? dict[key] : (I18N.uk[key] || key);
    if (vars) {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k]);
      });
    }
    return str;
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
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
    let choice = "auto";
    if (hasKsu()) {
      try {
        const { errno, stdout } = await exec(`cat ${shellQuote(UI_LANG_FILE)} 2>/dev/null`);
        if (errno === 0 && stdout.trim()) choice = stdout.trim();
      } catch (e) {}
    }
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
    if (findLang) renderLangUI();
    if (hasKsu()) {
      try { await exec(`echo -n ${shellQuote(choice)} > ${shellQuote(UI_LANG_FILE)}`); } catch (e) {}
    }
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
    if (locale) {
      await exec(`echo -n ${shellQuote(locale)} > ${shellQuote(LANG_FILE)}`);
    } else {
      await exec(`rm -f ${shellQuote(LANG_FILE)}`);
    }
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
    if (!n || isNaN(n)) return "—";
    const units = ["Б", "КБ", "МБ", "ГБ"];
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

  // ---- session log (in-panel, exportable) --------------------------------
  const sessionLog = [];
  const LOG_FILE = "/sdcard/Download/td2tdr_log.txt";
  function addLog(msg) {
    const line = `[${new Date().toLocaleTimeString("uk-UA")}] ${msg}`;
    sessionLog.push(line);
    const elLog = $("log");
    if (elLog) {
      elLog.textContent = sessionLog.join("\n");
      elLog.scrollTop = elLog.scrollHeight;
    }
    // append to file on device (fire-and-forget)
    if (hasKsu()) {
      exec(`echo ${shellQuote(line)} >> ${shellQuote(LOG_FILE)}`).catch(() => {});
    }
  }

  // ---- real sync ----------------------------------------------------------
  async function syncFile() {
    const cmd =
      `mkdir -p ${shellQuote(DST_DIR)} && ` +
      `cp -f ${shellQuote(SRC)} ${shellQuote(DST)} && ` +
      `if [ -f ${shellQuote(SRC_USER)} ]; then cp -f ${shellQuote(SRC_USER)} ${shellQuote(DST_USER)}; fi && ` +
      `chmod 0644 ${shellQuote(DST)} ${shellQuote(DST_USER)} && ` +
      `echo "$(date '+%Y-%m-%d %H:%M:%S') Синхронізовано через WebUI" >> ${shellQuote(LOG)}`;
    const { errno, stderr } = await exec(cmd);
    if (errno !== 0) {
      addLog(`Помилка синхронізації: ${stderr || "код " + errno}`);
      return false;
    }
    addLog("Файли синхронізовано вручну через WebUI");
    return true;
  }

  // ---- real browser open (system default, via Android intent) ------------
  async function openUrl(url) {
    const cmd = `am start -a android.intent.action.VIEW -d ${shellQuote(url)} -c android.intent.category.BROWSABLE`;
    const { errno, stderr } = await exec(cmd);
    if (errno !== 0) {
      addLog(`Не вдалося відкрити посилання: ${stderr || "код " + errno}`);
      toast("Не вдалося відкрити посилання");
      return false;
    }
    return true;
  }

  // ---- convert xx_YY -> xx-YY (BCP-47, required by `cmd locale`) --------
  function toBcp47(locale) {
    return locale ? locale.replace("_", "-") : "";
  }

  // ---- custom language dropdown ------------------------------------------
  function renderLangUI() {
    const menu = $("langMenu");
    if (!menu) return;
    menu.innerHTML = LANGS.map((l) => `
      <div class="lang-option${l.value === selectedLocale ? " selected" : ""}" role="option" data-value="${l.value}">
        <span class="lang-flag">${l.flag}</span>
        <span class="lang-opt-label">${l.label}</span>
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
    $("langTriggerLabel").textContent = cur.label;
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
    if (btn.classList.contains("onclic") || btn.classList.contains("validate")) return;

    const locale = selectedLocale; // e.g. "ru_RU" or "" for system default
    const bcp47 = toBcp47(locale);
    btn.disabled = true;
    btn.classList.add("onclic");

    await saveLocale(locale);
    addLog(`Мова: ${locale || "системна"}`);

    // --- Primary mechanism: Android per-app language (LocaleManager) ---
    // This is what Settings > Apps > App language uses under the hood.
    // Empty string resets the app back to following the system language.
    const { errno: locErr, stderr: locStderr } = await exec(
      `cmd locale set-app-locales com.hutchgames.cccg --user 0 --locales ${shellQuote(bcp47)}`
    );
    if (locErr !== 0) {
      addLog(`cmd locale помилка: ${locStderr || "код " + locErr}`);
    } else {
      const { stdout: verifyOut } = await exec(
        `cmd locale get-app-locales com.hutchgames.cccg --user 0`
      );
      addLog(`Per-app locale застосовано (перевірка: ${verifyOut.trim() || "?"})`);
    }

    // --- Fallback: patch cached prefs keys too, in case the game reads
    // them before re-evaluating LocaleManager on some cold starts ---
    if (locale) {
      const scriptPath = `${MODDIR}/set_locale.sh`;
      const { errno: shErr, stderr: shStderr } = await exec(
        `sh ${shellQuote(scriptPath)} ${shellQuote(locale)}`
      );
      if (shErr !== 0) {
        addLog(`set_locale.sh помилка: ${shStderr || "код " + shErr}`);
      } else {
        addLog(`set_locale.sh виконано для ${locale}`);
      }
    }

    addLog("Зупиняю гру…");
    await exec(`am force-stop com.hutchgames.cccg`);
    await new Promise(r => setTimeout(r, 1000));
    addLog("Запускаю гру…");
    const { errno } = await exec(
      `am start -n com.hutchgames.cccg/com.hutchgames.racegame.UnityPlayerActivity`
    );

    btn.classList.remove("onclic");
    if (errno === 0) {
      btn.classList.add("validate");
      setTimeout(() => btn.classList.remove("validate"), 1250);
      addLog("Гру запущено");
    } else {
      addLog("Помилка запуску гри");
      toast("Не вдалося запустити гру");
    }
    btn.disabled = false;
  }

  // ---- diagnose locale keys -------------------------------------------
  async function diagnoseLocale() {
    const GAME_PKG = "com.hutchgames.cccg";
    const SHARED_PREFS = `/data/data/${GAME_PKG}/shared_prefs`;
    addLog("=== ДІАГНОСТИКА МОВИ ===");
    addLog(`Шлях: ${SHARED_PREFS}`);

    const { errno: lsErr, stdout: lsOut } = await exec(`ls ${shellQuote(SHARED_PREFS)}/*.xml 2>/dev/null`);
    if (lsErr !== 0 || !lsOut.trim()) {
      addLog("shared_prefs XML не знайдено");
      return;
    }
    const files = lsOut.trim().split(/\s+/);
    for (const f of files) {
      addLog(`--- Файл: ${f.split("/").pop()} ---`);
      const { stdout } = await exec(`grep '<string ' ${shellQuote(f)} 2>/dev/null`);
      if (stdout.trim()) {
        const lines = stdout.trim().split("\n");
        for (const line of lines) {
          addLog(`  ${line.trim()}`);
        }
      } else {
        addLog("  (немає <string> записів)");
      }
    }
    addLog("=== КІНЕЦЬ ДІАГНОСТИКИ ===");
  }

  // ---- status refresh -------------------------------------------------
  async function refresh() {
    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.classList.add("spinning");

    if (!hasKsu()) {
      $("statusMeta").textContent = t("status_no_ksu");
      $("checkSrc").className = "flow-dot bad";
      $("checkDst").className = "flow-dot bad";
      $("checkResult").className = "flow-dot bad";
      if ($("srcFlowStatus")) $("srcFlowStatus").textContent = t("status_no_access");
      if ($("dstFlowStatus")) $("dstFlowStatus").textContent = t("status_no_access");
      if ($("resultFlowStatus")) $("resultFlowStatus").textContent = t("status_dash");
      if (refreshBtn) refreshBtn.classList.remove("spinning");
      return;
    }

    const src = await statPath(SRC);
    const dst = await statPath(DST);

    const checkSrc = $("checkSrc");
    const checkDst = $("checkDst");
    const checkResult = $("checkResult");
    const statusIcon = $("statusIcon");
    const srcFlowStatus = $("srcFlowStatus");
    const dstFlowStatus = $("dstFlowStatus");
    const resultFlowStatus = $("resultFlowStatus");

    checkSrc.className = `flow-dot ${src ? "ok" : "bad"}`;
    checkDst.className = `flow-dot ${dst ? "ok" : "warn"}`;
    if (srcFlowStatus) srcFlowStatus.textContent = src ? `${t("flow_found")} · ${formatBytes(src.size)}` : t("flow_not_found_src");
    if (dstFlowStatus) dstFlowStatus.textContent = dst ? `${t("flow_found")} · ${formatBytes(dst.size)}` : t("flow_not_found_dst");

    if (src && dst) {
      const inSync = src.size === dst.size;
      checkResult.className = `flow-dot ${inSync ? "ok" : "warn"}`;
      if (resultFlowStatus) resultFlowStatus.textContent = inSync ? t("flow_in_sync") : t("flow_diff");
      if (statusIcon) statusIcon.className = `status-icon ${inSync ? "ok" : "warn"}`;
      $("statusMeta").textContent = inSync
        ? t("status_synced", { size: formatBytes(dst.size) })
        : t("status_size_mismatch", { src: formatBytes(src.size), dst: formatBytes(dst.size) });
    } else if (!src) {
      checkResult.className = "flow-dot bad";
      if (resultFlowStatus) resultFlowStatus.textContent = t("status_dash");
      if (statusIcon) statusIcon.className = "status-icon bad";
      $("statusMeta").textContent = t("status_no_garage");
    } else {
      checkResult.className = "flow-dot warn";
      if (resultFlowStatus) resultFlowStatus.textContent = t("flow_need");
      if (statusIcon) statusIcon.className = "status-icon warn";
      $("statusMeta").textContent = t("status_no_copy");
    }

    $("lastSync").textContent = dst ? new Date(dst.mtime * 1000).toLocaleString("uk-UA") : "—";

    if (refreshBtn) refreshBtn.classList.remove("spinning");
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
    return exec(`cat ${shellQuote(path)} 2>/dev/null`).then((r) => r.errno === 0 && r.stdout ? r.stdout : "");
  }

  // читаємо оригінал гри напряму; якщо його нема — фолбек на синхронізовану копію
  async function readSourceFile(primary, fallback) {
    const data = await readFile(primary);
    return data || readFile(fallback);
  }

  async function loadResources() {
    const data = await readSourceFile(SRC_USER, DST_USER);
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
    if (fest != null) {
      const pct = Math.min(100, (fest / PRESTIGE_MAX) * 100);
      const fill = $("prestigeFill");
      fill.style.width = pct + "%";
      fill.className = "bar-fill p-" + (pct >= 90 ? "red" : pct >= 75 ? "orange" : pct >= 50 ? "yellow" : "green");
      $("prestigeText").textContent = `${fest.toLocaleString("uk-UA")} / ${PRESTIGE_MAX.toLocaleString("uk-UA")}`;
      const warn = $("prestigeWarn");
      if (fest >= 900) {
        warn.textContent = "Очки престижу скоро згорять від переповнення — витратьте їх";
        warn.style.display = "block";
      } else {
        warn.style.display = "none";
      }
    } else {
      $("prestigeText").textContent = `— / ${PRESTIGE_MAX.toLocaleString("uk-UA")}`;
      $("prestigeFill").style.width = "0%";
      $("prestigeFill").className = "bar-fill";
    }
    $("resourcesEmpty").style.display = "none";
    $("resourcesGrid").style.display = "flex";
    addLog("Ресурси завантажено з user.dat");
  }

  // стек-шкала: кольорові сегменти + легенда. parts: [{k,label,color,n?}], counts: {k:n}
  function renderStack(barId, legendId, parts, counts, total) {
    const n = (p) => (counts ? counts[p.k] || 0 : p.n || 0);
    const t = total || parts.reduce((s, p) => s + n(p), 0);
    $(barId).innerHTML = parts.map((p) => {
      const cnt = n(p);
      const w = t ? Math.max(0, (cnt / t) * 100) : 0;
      return `<div class="bar-seg" style="flex-basis:${w}%;background:${p.color}" title="${p.label}: ${cnt}"></div>`;
    }).join("");
    $(legendId).innerHTML = parts.map((p) => {
      const cnt = n(p);
      const pct = t ? Math.round((cnt / t) * 100) : 0;
      return `<span class="legend-item"><i style="background:${p.color}"></i>${p.label}: <b>${cnt.toLocaleString("uk-UA")}</b> (${pct}%)</span>`;
    }).join("");
  }

  async function loadGarageStats() {
    const loadBtn = $("loadGarage");
    if (loadBtn) { loadBtn.disabled = true; loadBtn.textContent = t("garage_analyzing"); }
    try {
      const data = await readSourceFile(SRC, DST);
      if (!data) {
        addLog("Гараж: файл гри не знайдено (" + SRC + ")");
        toast("Garage.dat гри не знайдено — переконайтеся, що гра запускалась");
        return;
      }
      const line = data.split(/\r?\n/).find((l) => l.startsWith("PlayerDeck="));
      if (!line) { addLog("Гараж: рядок PlayerDeck не знайдено у файлі"); return; }
      const m = line.match(/^PlayerDeck=[^,]+,s(.+)$/);
      if (!m) { addLog("Гараж: не вдалося розібрати PlayerDeck"); return; }
      const cards = JSON.parse(m[1]);

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

      $("garageTotalNum").textContent = total.toLocaleString("uk-UA");
      $("garageHeldLine").textContent = t("garage_held", { held: held.toLocaleString("uk-UA") });

      // заповнення гаража
      const fillPct = myCars ? Math.min(100, (locked / myCars) * 100) : 0;
      const garageFill = $("garageFill");
      garageFill.style.width = fillPct + "%";
      garageFill.className = "bar-fill p-" + (fillPct >= 90 ? "red" : fillPct >= 75 ? "orange" : fillPct >= 50 ? "yellow" : "green");
      $("garageBarText").textContent = `${locked.toLocaleString("uk-UA")} / ${myCars.toLocaleString("uk-UA")}`;

      // прокачка — стек-шкала
      const counts = { "111": 0, "332": 0, "323": 0, "233": 0, "custom": 0 };
      for (const c of cards) counts[upgradeKey(c)]++;
      $("upgradeBarText").textContent = total.toLocaleString("uk-UA");
      renderStack("upgradeBar", "upgradeLegend", [
        { k: "111", label: UPGRADE_LABELS["111"], color: "#3ddc84" },
        { k: "332", label: UPGRADE_LABELS["332"], color: "#4d7cff" },
        { k: "323", label: UPGRADE_LABELS["323"], color: "#a06bff" },
        { k: "233", label: UPGRADE_LABELS["233"], color: "#ff9f43" },
        { k: "custom", label: t("upg_custom"), color: "#6b7284" },
      ], counts, total);

      // бої — стек-шкала
      $("battleBarText").textContent = battleTotal.toLocaleString("uk-UA");
      renderStack("battleBar", "battleLegend", [
        { k: "w", label: t("battle_wins"), color: "#3ddc84", n: battle.w },
        { k: "d", label: t("battle_draws"), color: "#ffb545", n: battle.d },
        { k: "l", label: t("battle_losses"), color: "#ff5c7a", n: battle.l },
      ], null, battleTotal);

      $("garageEmpty").style.display = "none";
      $("garageStats").style.display = "block";
      $("garageMeta").style.display = "block";
      addLog(`Гараж проаналізовано: ${total} авто (${locked} locked, ${total - locked} held)`);
      await loadResources();
    } catch (e) {
      addLog(`Помилка аналізу гаража: ${e.message}`);
    } finally {
      if (loadBtn) { loadBtn.disabled = false; loadBtn.textContent = t("garage_calc_btn"); }
    }
  }

  // ---- wire up ----------------------------------------------------------
  // ---- theme (auto / light / dark) ---------------------------------------
  const systemLightMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function applyResolvedTheme(choice) {
    const resolved = choice === "auto"
      ? (systemLightMedia && systemLightMedia.matches ? "light" : "dark")
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
    let choice = "auto";
    if (hasKsu()) {
      try {
        const { errno, stdout } = await exec(`cat ${shellQuote(THEME_FILE)} 2>/dev/null`);
        if (errno === 0 && stdout.trim()) choice = stdout.trim();
      } catch (e) {}
    }
    if (!["auto", "light", "dark"].includes(choice)) choice = "auto";
    currentThemeChoice = choice;
    applyResolvedTheme(choice);
    updateThemeSwitchUI(choice);
  }

  async function setTheme(choice) {
    currentThemeChoice = choice;
    applyResolvedTheme(choice);
    updateThemeSwitchUI(choice);
    if (hasKsu()) {
      try { await exec(`echo -n ${shellQuote(choice)} > ${shellQuote(THEME_FILE)}`); } catch (e) {}
    }
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
    return btoa(unescape(encodeURIComponent(str)));
  }

  async function loadHistory() {
    if (!hasKsu()) return [];
    const { errno, stdout } = await exec(`cat ${shellQuote(HISTORY_FILE)} 2>/dev/null`);
    if (errno !== 0 || !stdout.trim()) return [];
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  }

  async function saveHistory(history) {
    const content = history.map((h) => JSON.stringify(h)).join("\n") + "\n";
    const b64 = base64EncodeUtf8(content);
    await exec(`echo ${shellQuote(b64)} | base64 -d > ${shellQuote(HISTORY_FILE)}`);
  }

  async function getResourceSnapshot() {
    const data = await readSourceFile(SRC_USER, DST_USER);
    if (!data) return null;
    const val = (key) => {
      const m = data.match(new RegExp(`${key}=[0-9A-F]{8},i(\\d+)`));
      return m ? Number(m[1]) : null;
    };
    return { cash: val("Cash"), gold: val("Gold"), prestige: val("FestivalPasses") };
  }

  async function getGarageSnapshot() {
    const data = await readSourceFile(SRC, DST);
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
      addLog(`Аналітика: помилка запису знімка (${e.message})`);
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

  function renderSparkline(history, key, color) {
    const points = history.filter((h) => h[key] != null);
    if (points.length < 2) return `<div class="an-empty">${t("an_not_enough")}</div>`;
    const values = points.map((p) => p[key]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const W = 300, H = 60, PAD = 4;
    const stepX = (W - PAD * 2) / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - ((p[key] - min) / range) * (H - PAD * 2);
      return [x, y];
    });
    const path = coords.map((c, i) => (i === 0 ? "M" : "L") + c[0].toFixed(1) + "," + c[1].toFixed(1)).join(" ");
    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaPath = `${path} L${last[0].toFixed(1)},${H - PAD} L${first[0].toFixed(1)},${H - PAD} Z`;
    return `
      <svg viewBox="0 0 ${W} ${H}" class="an-chart" preserveAspectRatio="none">
        <path d="${areaPath}" fill="${color}" opacity="0.14"></path>
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="${color}"></circle>
      </svg>
    `;
  }

  function linearForecastDays(history, key, target) {
    const pts = history.filter((h) => h[key] != null).slice(-14);
    if (pts.length < 3) return null;
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

  function renderMetric(history, key, title, color) {
    const points = history.filter((h) => h[key] != null);
    const last = points.length ? points[points.length - 1][key] : null;
    const delta = computeDelta(history, key);
    const deltaCls = delta == null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const deltaText = delta == null ? "—" : (delta > 0 ? "+" : "") + delta.toLocaleString("uk-UA");
    return `
      <div class="an-metric">
        <div class="an-metric-head">
          <span class="an-metric-title">${title}</span>
          <span class="an-metric-value">${fmtNum(last)}</span>
          <span class="an-delta ${deltaCls}">${deltaText} ${t("an_delta_24h")}</span>
        </div>
        ${renderSparkline(history, key, color)}
      </div>
    `;
  }

  async function renderAnalytics() {
    const container = $("analyticsList");
    if (!container) return;
    if (!hasKsu()) {
      container.innerHTML = `<div class="garage-empty">${t("an_no_access")}</div>`;
      return;
    }
    const history = await loadHistory();
    if (!history.length) {
      container.innerHTML = `<div class="garage-empty">${t("an_no_data")}</div>`;
      return;
    }
    let html = "";
    html += renderMetric(history, "cash", t("an_cash"), "#3ddc84");
    html += renderMetric(history, "gold", t("an_gold"), "#ffb545");
    html += renderMetric(history, "prestige", t("an_prestige"), "#a06bff");
    html += renderMetric(history, "garageTotal", t("an_garage"), "#4d7cff");

    const forecastDays = linearForecastDays(history, "prestige", 1000);
    const prestigePts = history.filter((h) => h.prestige != null);
    const lastPrestige = prestigePts.length ? prestigePts[prestigePts.length - 1] : null;
    let forecastHtml = "";
    if (lastPrestige && lastPrestige.prestige >= 1000) {
      forecastHtml = `<div class="an-forecast">${t("an_forecast_max")}</div>`;
    } else if (forecastDays != null) {
      forecastHtml = `<div class="an-forecast">${t("an_forecast_days", { days: forecastDays })}</div>`;
    } else if (prestigePts.length >= 2) {
      forecastHtml = `<div class="an-forecast">${t("an_forecast_flat")}</div>`;
    }

    container.innerHTML = html + forecastHtml;
  }

  // ---- changelog ----------------------------------------------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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

  async function loadChangelog() {
    const container = $("changelogList");
    if (!container) return;
    if (!hasKsu()) {
      container.innerHTML = `<div class="garage-empty">${t("an_no_access")}</div>`;
      return;
    }
    try {
      const { errno, stdout } = await exec(`cat ${shellQuote(MODDIR + "/changelog.md")} 2>/dev/null`);
      if (errno !== 0 || !stdout.trim()) {
        container.innerHTML = `<div class="garage-empty">${t("cl_load_error")}</div>`;
        return;
      }
      const versions = parseChangelog(stdout);
      container.innerHTML = renderChangelog(versions);
      container.querySelectorAll(".cl-entry").forEach((entry) => {
        const head = entry.querySelector(".cl-head");
        if (head) head.addEventListener("click", () => entry.classList.toggle("expanded"));
      });
    } catch (e) {
      container.innerHTML = `<div class="garage-empty">${t("cl_load_error")}</div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    addLog("Сесію розпочато");
    window.addEventListener("error", (e) => addLog(`ПОМИЛКА: ${e.message}`));
    window.addEventListener("unhandledrejection", (e) => addLog(`НЕОБРОБЛЕНА ПОМИЛКА: ${e.reason}`));

    applyI18n();
    initUiLangSwitch();
    loadUiLang();

    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", refresh);

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
      if (syncAndOpen.classList.contains("onclic") || syncAndOpen.classList.contains("validate")) return;
      syncAndOpen.disabled = true;
      syncAndOpen.classList.add("onclic");
      const ok = await syncFile();
      await refresh();
      if (ok) {
        toast("Синхронізовано");
        await openUrl("https://www.topdrivesrecords.com/me");
      }
      syncAndOpen.classList.remove("onclic");
      if (ok) {
        syncAndOpen.classList.add("validate");
        setTimeout(() => syncAndOpen.classList.remove("validate"), 1250);
      }
      syncAndOpen.disabled = false;
    });

    const downloadLog = $("downloadLog");
    if (downloadLog) downloadLog.addEventListener("click", () => {
      toast("Журнал збережено: " + LOG_FILE);
      addLog("Журнал збережено в " + LOG_FILE);
    });

    const sendLog = $("sendLog");
    if (sendLog) sendLog.addEventListener("click", async () => {
      const endpoint = prompt("Введіть URL серверу для відправки журналу:");
      if (!endpoint) return;
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ log: sessionLog }),
        });
        alert("Журнал успішно відправлено");
      } catch (e) {
        alert("Не вдалося відправити журнал: " + e.message);
      }
    });

    // Settings modal (display-only — kept for future real path support)
    const settingsBtn = $("settingsBtn");
    const settingsModal = $("settingsModal");
    if (settingsBtn) settingsBtn.addEventListener("click", () => { settingsModal.style.display = "flex"; });
    const closeSettings = $("closeSettings");
    if (closeSettings) closeSettings.addEventListener("click", () => { settingsModal.style.display = "none"; });

    const defaultSettings = $("defaultSettings");
    if (defaultSettings) defaultSettings.addEventListener("click", () => {
      localStorage.setItem("td2tdr_settings", JSON.stringify({ src: SRC, dst: DST_DIR }));
      loadSettings();
    });

    const saveSettings = $("saveSettings");
    if (saveSettings) saveSettings.addEventListener("click", () => {
      settingsModal.style.display = "none";
      toast("Наразі шлях фіксований модулем; налаштування лише для довідки");
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
    refresh();
    loadChangelog();
    initThemeSwitch();
    loadTheme();
    recordSnapshotIfNeeded().then(renderAnalytics);
    const clearHistoryBtn = $("clearHistoryBtn");
    if (clearHistoryBtn) clearHistoryBtn.addEventListener("click", async () => {
      if (!hasKsu()) return;
      await exec(`rm -f ${shellQuote(HISTORY_FILE)}`);
      addLog("Історію аналітики очищено");
      renderAnalytics();
    });
    setInterval(refresh, 15000);
  });
})();
