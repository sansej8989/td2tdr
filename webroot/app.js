(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const MODDIR = "/data/adb/modules/td2tdr_sync";
  const SRC = "/storage/emulated/0/Android/data/com.hutchgames.cccg/files/Garage.dat";
  const DST_DIR = "/storage/emulated/0/Download/td2tdr_sync";
  const DST = `${DST_DIR}/Garage.dat`;
  const LOG = `${MODDIR}/sync.log`;

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
  function addLog(msg) {
    sessionLog.push(`[${new Date().toLocaleTimeString("uk-UA")}] ${msg}`);
    const elLog = $("log");
    if (elLog) {
      elLog.textContent = sessionLog.join("\n");
      elLog.scrollTop = elLog.scrollHeight;
    }
  }

  // ---- real sync ----------------------------------------------------------
  async function syncFile() {
    const cmd =
      `mkdir -p ${shellQuote(DST_DIR)} && ` +
      `cp -f ${shellQuote(SRC)} ${shellQuote(DST)} && ` +
      `chmod 0644 ${shellQuote(DST)} && ` +
      `echo "$(date '+%Y-%m-%d %H:%M:%S') Синхронізовано через WebUI" >> ${shellQuote(LOG)}`;
    const { errno, stderr } = await exec(cmd);
    if (errno !== 0) {
      addLog(`Помилка синхронізації: ${stderr || "код " + errno}`);
      return false;
    }
    addLog("Файл синхронізовано вручну через WebUI");
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

  // ---- status refresh -------------------------------------------------
  async function refresh() {
    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.classList.add("spinning");

    if (!hasKsu()) {
      $("statusMeta").textContent = "Немає доступу до ksu (відкрийте через менеджер)";
      $("checkSrc").className = "flow-dot bad";
      $("checkDst").className = "flow-dot bad";
      $("checkResult").className = "flow-dot bad";
      if ($("srcFlowStatus")) $("srcFlowStatus").textContent = "Немає доступу";
      if ($("dstFlowStatus")) $("dstFlowStatus").textContent = "Немає доступу";
      if ($("resultFlowStatus")) $("resultFlowStatus").textContent = "—";
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
    if (srcFlowStatus) srcFlowStatus.textContent = src ? `Є · ${formatBytes(src.size)}` : "Не знайдено";
    if (dstFlowStatus) dstFlowStatus.textContent = dst ? `Є · ${formatBytes(dst.size)}` : "Немає";

    if (src && dst) {
      const inSync = src.size === dst.size;
      checkResult.className = `flow-dot ${inSync ? "ok" : "warn"}`;
      if (resultFlowStatus) resultFlowStatus.textContent = inSync ? "Синхрон." : "Відрізн.";
      if (statusIcon) statusIcon.className = `status-icon ${inSync ? "ok" : "warn"}`;
      $("statusMeta").textContent = inSync
        ? `Синхронізовано · ${formatBytes(dst.size)}`
        : `Розбіжність розміру: джерело ${formatBytes(src.size)}, копія ${formatBytes(dst.size)}`;
    } else if (!src) {
      checkResult.className = "flow-dot bad";
      if (resultFlowStatus) resultFlowStatus.textContent = "—";
      if (statusIcon) statusIcon.className = "status-icon bad";
      $("statusMeta").textContent = "Garage.dat гри не знайдено";
    } else {
      checkResult.className = "flow-dot warn";
      if (resultFlowStatus) resultFlowStatus.textContent = "Потрібно";
      if (statusIcon) statusIcon.className = "status-icon warn";
      $("statusMeta").textContent = "Копії ще немає — натисніть «Синхронізувати та відкрити»";
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

  async function loadGarageStats() {
    const loadBtn = $("loadGarage");
    if (loadBtn) { loadBtn.disabled = true; loadBtn.textContent = "Аналіз…"; }
    try {
      const { errno, stdout } = await exec(`cat ${shellQuote(DST)} 2>/dev/null`);
      if (errno !== 0 || !stdout) {
        addLog("Гараж: копії файлу ще немає — спершу синхронізуйте");
        toast("Спершу натисніть «Синхронізувати та відкрити»");
        return;
      }
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith("PlayerDeck="));
      if (!line) { addLog("Гараж: рядок PlayerDeck не знайдено у файлі"); return; }
      const m = line.match(/^PlayerDeck=[^,]+,s(.+)$/);
      if (!m) { addLog("Гараж: не вдалося розібрати PlayerDeck"); return; }
      const cards = JSON.parse(m[1]);

      const total = cards.length;
      const counts = { "111": 0, "332": 0, "323": 0, "233": 0, "custom": 0 };
      for (const c of cards) counts[upgradeKey(c)]++;

      $("garageTotalNum").textContent = total.toLocaleString("uk-UA");
      const grid = $("garageUpgradeGrid");
      grid.innerHTML = Object.keys(UPGRADE_LABELS).map((k) => {
        const n = counts[k];
        const pct = total ? Math.round((n / total) * 100) : 0;
        return `<div class="garage-tile">
          <div class="garage-tile-num">${n.toLocaleString("uk-UA")}</div>
          <div class="garage-tile-lbl">${UPGRADE_LABELS[k]}</div>
          <div class="garage-tile-pct">${pct}%</div>
        </div>`;
      }).join("");

      $("garageEmpty").style.display = "none";
      $("garageStats").style.display = "block";
      addLog(`Гараж проаналізовано: ${total} авто`);
    } catch (e) {
      addLog(`Помилка аналізу гаража: ${e.message}`);
    } finally {
      if (loadBtn) { loadBtn.disabled = false; loadBtn.textContent = "Порахувати"; }
    }
  }

  // ---- wire up ----------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    addLog("Сесію розпочато");
    window.addEventListener("error", (e) => addLog(`ПОМИЛКА: ${e.message}`));
    window.addEventListener("unhandledrejection", (e) => addLog(`НЕОБРОБЛЕНА ПОМИЛКА: ${e.reason}`));

    const refreshBtn = $("refreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", refresh);

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
      const blob = new Blob([sessionLog.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "td2tdr_log.txt";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
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

    loadSettings();
    refresh();
    setInterval(refresh, 15000);
  });
})();
