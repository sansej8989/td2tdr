#!/system/bin/sh
# Copy Garage.dat / user.dat into Download so an unprivileged browser can read them.
# Root `cp` into /storage/emulated/0 leaves magisk_file + uid 0; Chrome then
# feeds the site empty/torn bytes → "NOT valid JSON".
#
# Write via /data/media/0, chown media_rw, restorecon, atomic mv, MediaStore scan.

MODDIR="${0%/*}"
LOG="${MODDIR}/sync.log"

SRC="/storage/emulated/0/Android/data/com.hutchgames.cccg/files/Garage.dat"
SRC_USER="/storage/emulated/0/Android/data/com.hutchgames.cccg/files/user.dat"
# Fallback, якщо /storage/emulated/0 заблокований Scoped Storage —
# той самий файл через raw-шлях /data/media (доступний із root).
SRC_ROOT="/data/media/0/Android/data/com.hutchgames.cccg/files/Garage.dat"
SRC_USER_ROOT="/data/media/0/Android/data/com.hutchgames.cccg/files/user.dat"

if [ -d /data/media/0 ]; then
    DST_DIR="/data/media/0/Download/td2tdr_sync"
else
    DST_DIR="/storage/emulated/0/Download/td2tdr_sync"
fi
PUB_DIR="/storage/emulated/0/Download/td2tdr_sync"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"
}

pause() {
    sleep 0.3 2>/dev/null || sleep 1
}

# ----- v0.0.516: фоновий автозапис знімка в history.jsonl -----
# Аргументи:
#   $1 = DST_DIR (primary)         напр. /data/media/0/Download/td2tdr_sync
#   $2 = DST_DIR_ALT (mirror)     напр. /storage/emulated/0/Download/td2tdr_sync
#   $3 = DST_USER (скопійований user.dat)
#   $4 = DST     (скопійований Garage.dat)
# Поведінка:
#   - Парсить Cash / Gold / FestivalPasses із user.dat за 3-tier regex
#     (canonical → flexible hex → bare `i<digits>`).
#   - Парсить garageTotal / garageLocked із Garage.dat PlayerDeck=...
#   - Якщо ВСІ ресурси null → WARN і повернення без запису (Patch I в shell).
#   - Dedup за сьогоднішньою датою (ISO YYYY-MM-DD): якщо рядок вже є —
#     перезаписуємо його полями (Object.assign-аналог в shell).
#   - Атомарний запис у primary + alt через `<file>.tmp` + `mv -f`.
record_history_snapshot() {
    local PRIMARY_DIR="$1"
    local ALT_DIR="$2"
    local USER_FILE="$3"
    local GARAGE_FILE="$4"
    local HISTORY="$PRIMARY_DIR/history.jsonl"
    local HISTORY_ALT="$ALT_DIR/history.jsonl"
    local HISTORY_TMP="$HISTORY.tmp"
    local HISTORY_ALT_TMP="$HISTORY_ALT.tmp"
    local TODAY
    TODAY=$(date +%Y-%m-%d)
    local NOW_TS
    NOW_TS=$(date +%s)000  # мілісекунди, як у JS Date.now()

    # --- 1. Парсинг ресурсів (3-tier fallback) ---
    # Кожна змінна отримує значення, якщо знайдено; інакше залишається "".
    parse_val() {
        local key="$1" file="$2"
        [ -f "$file" ] || return 1
        local v
        # Tier 1: KEY=[0-9A-F]{8},i(\d+)
        v=$(grep -oE "^${key}=[0-9A-F]{8},i[0-9]+" "$file" 2>/dev/null | head -n1 | sed -E "s/^${key}=[0-9A-F]{8},i//")
        # Tier 2: KEY=[0-9A-F]+,i(\d+)
        if [ -z "$v" ]; then
            v=$(grep -oE "^${key}=[0-9A-F]+,i[0-9]+" "$file" 2>/dev/null | head -n1 | sed -E "s/^${key}=[0-9A-F]+,i//")
        fi
        # Tier 3: KEY=i(\d+) (без hex-префікса)
        if [ -z "$v" ]; then
            v=$(grep -oE "^${key}=i[0-9]+" "$file" 2>/dev/null | head -n1 | sed -E "s/^${key}=i//")
        fi
        [ -n "$v" ] && echo "$v" || return 1
    }

    local CASH GLD PRESTIGE
    CASH=$(parse_val "Cash" "$USER_FILE")
    GLD=$(parse_val "Gold" "$USER_FILE")
    PRESTIGE=$(parse_val "FestivalPasses" "$USER_FILE")

    # Garage: PlayerDeck=<hex>,s<JSON-array>; cards мають поле `locked`.
    # Витягуємо JSON-частину через sed і рахуємо масив.
    local G_TOTAL G_LOCKED=""
    if [ -f "$GARAGE_FILE" ]; then
        local DECK_JSON
        DECK_JSON=$(grep -oE '^PlayerDeck=[^,]+,s\[.*\]' "$GARAGE_FILE" 2>/dev/null | head -n1 | sed -E 's/^PlayerDeck=[^,]+,s//')
        if [ -n "$DECK_JSON" ]; then
            # Валідація через sed: підраховуємо об'єкти `{...}` на верхньому рівні.
            # Спрощений підрахунок: кількість "locked":true/false.
            G_TOTAL=$(echo "$DECK_JSON" | grep -oE '\{[^{}]*\}' | wc -l | tr -d ' ')
            G_LOCKED=$(echo "$DECK_JSON" | grep -oE '\{[^{}]*"locked":(true|false)[^{}]*\}' | grep -c '"locked":true' || true)
        fi
    fi

    # --- 2. Patch I в shell: захист від порожнього знімка ---
    if [ -z "$CASH$GLD$PRESTIGE$G_TOTAL" ]; then
        log "WARN: history snapshot — усі ресурси порожні (user.dat пошкоджений?), знімок пропущено"
        return 0
    fi

    # --- 3. Побудувати JSON-рядок нового запису ---
    # Уникаємо залежностей від jq: формуємо вручну через printf.
    local ENTRY
    ENTRY=$(printf '{"date":"%s","ts":%s' "$TODAY" "$NOW_TS")
    [ -n "$CASH" ]     && ENTRY=$(printf '%s,"cash":%s'     "$ENTRY" "$CASH")
    [ -n "$GLD" ]      && ENTRY=$(printf '%s,"gold":%s'      "$ENTRY" "$GLD")
    [ -n "$PRESTIGE" ] && ENTRY=$(printf '%s,"prestige":%s' "$ENTRY" "$PRESTIGE")
    [ -n "$G_TOTAL" ]  && ENTRY=$(printf '%s,"garageTotal":%s'  "$ENTRY" "$G_TOTAL")
    [ -n "$G_LOCKED" ] && ENTRY=$(printf '%s,"garageLocked":%s' "$ENTRY" "$G_LOCKED")
    ENTRY="$ENTRY}"

    # --- 4. Дедуплікація: прочитати існуючий history.jsonl, видалити рядки з
    # сьогоднішньою датою, додати новий рядок, посортувати (якщо немає —
    # просто створюємо новий файл). ---
    local EXISTING=""
    if [ -f "$HISTORY" ]; then
        EXISTING=$(grep -v "^${TODAY}," "$HISTORY" 2>/dev/null || true)
    fi
    local NEW_CONTENT
    if [ -n "$EXISTING" ]; then
        # EXISTING вже містить \n на кінці (або ні, якщо файл без фінального
        # переведення рядка). Гарантуємо відсутність подвійного \n.
        NEW_CONTENT=$(printf '%s\n%s\n' "$EXISTING" "$ENTRY")
    else
        NEW_CONTENT=$(printf '%s\n' "$ENTRY")
    fi

    # --- 5. Атомарний запис: tmp + mv у primary, потім у alt ---
    if ! printf '%s' "$NEW_CONTENT" > "$HISTORY_TMP" 2>>"$LOG"; then
        log "history snapshot: помилка запису tmp ($HISTORY_TMP)"
        return 1
    fi
    if ! mv -f "$HISTORY_TMP" "$HISTORY" 2>>"$LOG"; then
        log "history snapshot: помилка mv ($HISTORY_TMP -> $HISTORY)"
        return 1
    fi
    chmod 0644 "$HISTORY" 2>/dev/null

    # Дзеркало: best-effort (збій не блокує primary).
    if [ -f "$HISTORY_ALT" ] || [ -d "$ALT_DIR" ]; then
        if printf '%s' "$NEW_CONTENT" > "$HISTORY_ALT_TMP" 2>>"$LOG" \
            && mv -f "$HISTORY_ALT_TMP" "$HISTORY_ALT" 2>>"$LOG"; then
            chmod 0644 "$HISTORY_ALT" 2>/dev/null
        else
            log "history snapshot: дзеркало не оновлено (не критично)"
        fi
    fi

    log "history snapshot: $TODAY записано (cash=$CASH gold=$GLD prestige=$PRESTIGE gTotal=$G_TOTAL gLocked=$G_LOCKED)"
    return 0
}

# Wait until size stops changing (game still flushing) and is > 0.
wait_stable() {
    local f="$1" s d i=0
    s=$(stat -c %s "$f" 2>/dev/null) || return 1
    while [ "$i" -lt 5 ]; do
        pause
        d=$(stat -c %s "$f" 2>/dev/null) || return 1
        if [ -n "$s" ] && [ "$s" = "$d" ] && [ "$s" -gt 0 ]; then
            echo "$s"
            return 0
        fi
        s=$d
        i=$((i + 1))
    done
    return 1
}

fixup() {
    local f="$1"
    chmod 0644 "$f"
    chown 1023:1023 "$f" 2>/dev/null || chown media_rw:media_rw "$f" 2>/dev/null
    restorecon "$f" 2>/dev/null || chcon u:object_r:media_rw_data_file:s0 "$f" 2>/dev/null
}

scan() {
    local name="$1"
    local path="${PUB_DIR}/${name}"
    # Android 10+: MEDIA_SCANNER_SCAN_FILE broadcast is ignored; Chrome reads
    # the file via ContentProvider and gets stale (old-size) bytes → "NOT valid JSON".
    # Delete the old MediaStore row so the next access re-indexes the fresh file.
    content delete --uri content://media/external/file \
        --where "_data='${path}'" 2>/dev/null
    content delete --uri content://media/external/files \
        --where "_data='${path}'" 2>/dev/null
    # Legacy fallback (Android < 10)
    am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
        -d "file://${path}" >/dev/null 2>&1
}

copy_one() {
    local src="$1" name="$2"
    local dst="${DST_DIR}/${name}" tmp="${DST_DIR}/${name}.part"
    local want got

    [ -f "$src" ] || {
        log "${name}: джерело не знайдено ($src)"
        return 1
    }

    want=$(wait_stable "$src") || {
        log "Пропуск ${name}: джерело ще пишеться або порожнє"
        return 1
    }

    # Логуємо саме команду cp: видно, чи падає копіювання і чому
    if ! cp -f "$src" "$tmp" 2>>"$LOG"; then
        rm -f "$tmp"
        log "${name}: ПОМИЛКА cp (${src} -> ${tmp}) — див. повідомлення вище"
        return 1
    fi
    got=$(stat -c %s "$tmp" 2>/dev/null)
    if [ "$got" != "$want" ]; then
        rm -f "$tmp"
        log "Пропуск ${name}: розмір копії ${got} != ${want}"
        return 1
    fi
    if ! mv -f "$tmp" "$dst" 2>>"$LOG"; then
        log "${name}: ПОМИЛКА mv (${tmp} -> ${dst})"
        return 1
    fi
    fixup "$dst"
    scan "$name"
    log "${name}: скопійовано ${got} байт -> ${dst}"
    return 0
}

mkdir -p "$DST_DIR" || {
    log "Не вдалося створити $DST_DIR"
    echo "mkdir failed: $DST_DIR" >&2
    exit 1
}
chmod 0775 "$DST_DIR" 2>/dev/null
chown 1023:1023 "$DST_DIR" 2>/dev/null || chown media_rw:media_rw "$DST_DIR" 2>/dev/null
restorecon "$DST_DIR" 2>/dev/null || chcon u:object_r:media_rw_data_file:s0 "$DST_DIR" 2>/dev/null

# Обираємо робоче джерело: спершу стандартний шлях, якщо він недоступний
# (Scoped Storage) — raw-шлях через /data/media.
if [ -f "$SRC" ]; then
    EFF_SRC="$SRC"
elif [ -f "$SRC_ROOT" ]; then
    EFF_SRC="$SRC_ROOT"
    log "Основне джерело недоступне, використовую fallback: $SRC_ROOT"
else
    EFF_SRC="$SRC"
fi
log "Синхронізація: джерело=${EFF_SRC}, призначення=${DST_DIR}"
if [ -f "$SRC_USER" ]; then
    EFF_SRC_USER="$SRC_USER"
elif [ -f "$SRC_USER_ROOT" ]; then
    EFF_SRC_USER="$SRC_USER_ROOT"
else
    EFF_SRC_USER="$SRC_USER"
fi

if [ ! -f "$EFF_SRC" ]; then
    log "Файл-джерело не знайдено: $SRC"
    echo "source missing: $SRC" >&2
    exit 1
fi

if ! copy_one "$EFF_SRC" "Garage.dat"; then
    log "ПОМИЛКА: Garage.dat не скопійовано"
    echo "copy Garage.dat failed" >&2
    exit 1
fi

# Жорстка верифікація з ретраями: Android FUSE / MediaProvider іноді не
# одразу відображає новий файл у /data/media/0/, і миттєвий stat падає.
FINAL="$DST_DIR/Garage.dat"
PUB_FINAL="/storage/emulated/0/Download/td2tdr_sync/Garage.dat"

# Примусовий скидання кешу файлової системи на диск після копіювання
sync 2>/dev/null

verify_file() {
    # 3 спроби з паузою 0.5с — FUSE може «дозрівати» до секунди
    local f="$1" i=0
    while [ $i -lt 3 ]; do
        if [ -s "$f" ]; then
            stat -c %s "$f" 2>/dev/null && return 0
        fi
        sleep 0.5 2>/dev/null || sleep 1
        i=$((i + 1))
    done
    return 1
}

if ! SIZE=$(verify_file "$FINAL"); then
    # Можливо, cp створив файл, але він у дзеркальній теці — перевіряємо обидва
    ALT_FINAL="/data/media/0/Download/td2tdr_sync/Garage.dat"
    if [ "$ALT_FINAL" != "$FINAL" ] && SIZE=$(verify_file "$ALT_FINAL"); then
        FINAL="$ALT_FINAL"
        log "Файл знайдено у дзеркалі: $FINAL ($SIZE байт)"
    else
        # Fallback-копіювання напряму в публічний /storage шлях: деякі ROM
        # не дають shell писати в /data/media, але дають в /storage/emulated/0
        log "Верифікація не пройшла (${FINAL}) — пробую fallback у /storage"
        mkdir -p "/storage/emulated/0/Download/td2tdr_sync" 2>/dev/null
        if cp -f "$EFF_SRC" "$PUB_FINAL" 2>>"$LOG" && [ -s "$PUB_FINAL" ]; then
            chmod 0644 "$PUB_FINAL" 2>/dev/null
            chown 1023:1023 "$PUB_FINAL" 2>/dev/null || chown media_rw:media_rw "$PUB_FINAL" 2>/dev/null
            restorecon "$PUB_FINAL" 2>/dev/null || chcon u:object_r:media_rw_data_file:s0 "$PUB_FINAL" 2>/dev/null
            FINAL="$PUB_FINAL"
            SIZE=$(stat -c %s "$FINAL")
            log "Fallback-копіювання вдалось: $FINAL ($SIZE байт)"
            # Примусове оновлення MediaStore, щоб Chrome/ОС одразу бачили файл
            scan "Garage.dat"
        else
            log "ПОМИЛКА: файл не створено ні в одному з шляхів (перевірено ${FINAL}, ${ALT_FINAL}, ${PUB_FINAL})"
            echo "verify failed: Garage.dat missing/empty everywhere" >&2
            exit 3
        fi
    fi
fi

log "Верифікація: $FINAL ($SIZE байт) — ОК"

if [ -f "$EFF_SRC_USER" ]; then
    copy_one "$EFF_SRC_USER" "user.dat" || log "user.dat не скопійовано (не критично)"
fi

sync
log "Синхронізовано: $SRC -> ${DST_DIR}/Garage.dat"

# ----- v0.0.516: фоновий запис знімка в history.jsonl -----
# Парсимо вже скопійовані файли (DST_USER / DST) — гарантовано свіжі після
# `wait_stable` у copy_one. Це подія-орієнтований запис: спрацьовує
# щоразу, коли sync_now.sh завершується успіхом, незалежно від того,
# хто його викликав (service.sh polling/inotifywait, WebUI "Sync & Open",
# cron, adb shell тощо).
record_history_snapshot "$DST_DIR" "$DST_DIR_ALT" "$DST_USER" "$DST" || \
    log "history snapshot: помилка запису (не критично)"

exit 0