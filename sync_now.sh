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
exit 0