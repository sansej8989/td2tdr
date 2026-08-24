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

    [ -f "$src" ] || return 1

    want=$(wait_stable "$src") || {
        log "Пропуск ${name}: джерело ще пишеться або порожнє"
        return 1
    }

    cp -f "$src" "$tmp" || { rm -f "$tmp"; return 1; }
    got=$(stat -c %s "$tmp" 2>/dev/null)
    if [ "$got" != "$want" ]; then
        rm -f "$tmp"
        log "Пропуск ${name}: розмір копії ${got} != ${want}"
        return 1
    fi
    mv -f "$tmp" "$dst" || return 1
    fixup "$dst"
    scan "$name"
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

if [ ! -f "$SRC" ]; then
    log "Файл-джерело не знайдено: $SRC"
    echo "source missing: $SRC" >&2
    exit 1
fi

if ! copy_one "$SRC" "Garage.dat"; then
    echo "copy Garage.dat failed" >&2
    exit 1
fi

if [ -f "$SRC_USER" ]; then
    copy_one "$SRC_USER" "user.dat" || log "user.dat не скопійовано (не критично)"
fi

sync
log "Синхронізовано: $SRC -> ${DST_DIR}/Garage.dat"
exit 0