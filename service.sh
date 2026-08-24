#!/system/bin/sh
MODDIR=${0%/*}

# Чекаємо, поки система повністю завантажиться і storage буде змонтоване
while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 1
done
sleep 5

SRC="/storage/emulated/0/Android/data/com.hutchgames.cccg/files/Garage.dat"
SRC_USER="/storage/emulated/0/Android/data/com.hutchgames.cccg/files/user.dat"
DST_DIR="/storage/emulated/0/Download/td2tdr_sync"
DST="$DST_DIR/Garage.dat"
DST_USER="$DST_DIR/user.dat"
LOG="$MODDIR/sync.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"
}

mkdir -p "$DST_DIR"

# --- Force per-app language via Android's official LocaleManager API ---
# Android 13+ lets each app have its own UI language independent of the
# system language. This is the mechanism Settings > Apps > App language uses.
# Reads the locale chosen in the WebUI dropdown (${MODDIR}/locale, e.g.
# "ru_RU"); defaults to ru_RU if nothing was chosen yet.
GAME_PKG="com.hutchgames.cccg"
if [ -f "${MODDIR}/locale" ] && [ -s "${MODDIR}/locale" ]; then
    TARGET_LOCALE=$(cat "${MODDIR}/locale")
else
    TARGET_LOCALE="ru_RU"
fi
# Convert xx_YY -> xx-YY (BCP-47, required by `cmd locale`)
TARGET_BCP47=$(echo "$TARGET_LOCALE" | tr '_' '-')

if command -v cmd >/dev/null 2>&1; then
    cmd locale set-app-locales "$GAME_PKG" --user 0 --locales "$TARGET_BCP47" >> "$LOG" 2>&1
    CUR_APP_LOCALE=$(cmd locale get-app-locales "$GAME_PKG" --user 0 2>&1)
    log "Per-app locale for $GAME_PKG -> $TARGET_BCP47 (verify: $CUR_APP_LOCALE)"

    # Force-stop the game so it re-reads the locale fresh on next launch,
    # rather than keeping whatever it initialized with earlier this boot.
    if command -v am >/dev/null 2>&1; then
        am force-stop "$GAME_PKG" >> "$LOG" 2>&1
        log "Force-stopped $GAME_PKG to apply new locale on next launch"
    fi
else
    log "cmd binary not available, skipping per-app locale override"
fi

# Retry the sed-based prefs patch too, as a belt-and-suspenders fallback
# in case the app doesn't honor per-app locale for its own custom language key.
# Only touch it if the game isn't currently running, to avoid racing a live save.
if ! pidof "$GAME_PKG" >/dev/null 2>&1; then
    sh "${MODDIR}/set_locale.sh"
fi

sync_file() {
    sh "${MODDIR}/sync_now.sh"
}

# Початкова синхронізація одразу після завантаження
sync_file

# Якщо є inotifywait (busybox) — стежимо за файлом у реальному часі
if command -v inotifywait >/dev/null 2>&1; then
    log "Запускаю режим стеження через inotifywait"
    while true; do
        inotifywait -e close_write,create,moved_to \
            "$(dirname "$SRC")" 2>/dev/null | grep -q "Garage.dat" && sync_file
    done
else
    # Резервний варіант — періодична перевірка кожні 30 секунд
    log "inotifywait недоступний, перехід на опитування кожні 30с"
    LAST_MTIME=""
    while true; do
        if [ -f "$SRC" ]; then
            CUR_MTIME=$(stat -c %Y "$SRC" 2>/dev/null)
            if [ "$CUR_MTIME" != "$LAST_MTIME" ]; then
                sync_file
                LAST_MTIME="$CUR_MTIME"
            fi
        fi
        sleep 30
    done
fi
