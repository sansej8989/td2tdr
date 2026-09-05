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
LOG_MAX_LINES=200

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"
    # Ротація логів: тримаємо лише останні LOG_MAX_LINES рядків
    if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt "$LOG_MAX_LINES" ]; then
        tail -n "$LOG_MAX_LINES" "$LOG" > "${LOG}.tmp" 2>/dev/null && mv -f "${LOG}.tmp" "$LOG"
    fi
}

# --- Перевірка прав root ---
if [ "$(id -u)" != "0" ] && ! command -v su >/dev/null 2>&1; then
    echo "FATAL: no root available" >&2
    exit 1
fi

mkdir -p "$DST_DIR" || {
    log "Не вдалося створити $DST_DIR"
    exit 1
}

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

# Початкова синхронізація одразу після завантаження — користувач не має
# побачити пусту папку при першому відкритті WebUI.
sync_file

# Ретрай: якщо джерела ще не існувало на момент завантаження (гра не
# запускалась після оновлення) — чекаємо і пробуємо ще раз.
if [ ! -f "$SRC" ] && [ ! -f "/data/media/0/Android/data/com.hutchgames.cccg/files/Garage.dat" ]; then
    sleep 20
    sync_file
fi

# v0.0.516: мінімальний інтервал між гарантованими записами знімків.
# Якщо гра відкрита тривалий час без змін Garage.dat, polling/inotifywait
# можуть довго не спрацьовувати — а нам потрібен хоча б один знімок на
# HISTORY_FORCE_INTERVAL секунд, щоб зафіксувати зміни Cash/Gold/Prestige,
# які гра пише окремо від Garage.dat.
HISTORY_FORCE_INTERVAL=21600  # 6 годин
LAST_HISTORY_FORCE=$(date +%s)

maybe_force_history() {
    local NOW
    NOW=$(date +%s)
    if [ $((NOW - LAST_HISTORY_FORCE)) -ge $HISTORY_FORCE_INTERVAL ]; then
        log "force: періодичний запис знімка (≥ $HISTORY_FORCE_INTERVAL с)"
        sync_file
        LAST_HISTORY_FORCE=$NOW
    fi
}

# Якщо є inotifywait (busybox) — стежимо за файлом у реальному часі
if command -v inotifywait >/dev/null 2>&1; then
    log "Запускаю режим стеження через inotifywait"
    while true; do
        inotifywait -e close_write,create,moved_to -t $HISTORY_FORCE_INTERVAL \
            "$(dirname "$SRC")" 2>/dev/null | grep -q "Garage.dat" && sync_file
        # Якщо inotifywait нічого не дав за HISTORY_FORCE_INTERVAL секунд
        # (через -t), все одно виконуємо sync для запису знімка.
        maybe_force_history
    done
else
    # Резервний варіант — періодична перевірка за розміром + mtime.
    # Інтервал 60с з адаптивним backoff до 300с, якщо змін довго немає:
    # процесор практично не навантажується (один stat на цикл).
    log "inotifywait недоступний, перехід на опитування (розмір+mtime)"
    LAST_MTIME=""
    LAST_SIZE=""
    POLL=60
    POLL_MAX=300
    while true; do
        if [ -f "$SRC" ]; then
            CUR_MTIME=$(stat -c %Y "$SRC" 2>/dev/null)
            CUR_SIZE=$(stat -c %s "$SRC" 2>/dev/null)
            # Копіюємо лише коли дійсно змінилися розмір або timestamp
            if [ -n "$CUR_MTIME" ] && { [ "$CUR_MTIME" != "$LAST_MTIME" ] || [ "$CUR_SIZE" != "$LAST_SIZE" ]; }; then
                sync_file
                LAST_MTIME="$CUR_MTIME"
                LAST_SIZE="$CUR_SIZE"
                POLL=60   # була зміна — повертаємось до швидкого опитування
            else
                # без змін — сповільнюємось, економимо батарею
                if [ "$POLL" -lt "$POLL_MAX" ]; then
                    POLL=$((POLL * 2))
                    [ "$POLL" -gt "$POLL_MAX" ] && POLL=$POLL_MAX
                fi
            fi
        fi
        sleep $POLL
        # Періодичний примусовий sync — гарантує знімок раз на 6 годин,
        # навіть якщо mtime файлу не змінився (гра могла оновити лише user.dat
        # або просто тримати сесію без збереження Garage.dat).
        maybe_force_history
    done
fi
