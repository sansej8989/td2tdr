#!/system/bin/sh
MODDIR=${0%/*}

# Чекаємо, поки система повністю завантажиться і storage буде змонтоване
while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 1
done
sleep 5

SRC="/storage/emulated/0/Android/data/com.hutchgames.cccg/files/Garage.dat"
DST_DIR="/storage/emulated/0/Download/td2tdr_sync"
DST="$DST_DIR/Garage.dat"
LOG="$MODDIR/sync.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"
}

mkdir -p "$DST_DIR"

sync_file() {
    if [ -f "$SRC" ]; then
        cp -f "$SRC" "$DST" 2>/dev/null && {
            chmod 0644 "$DST"
            log "Синхронізовано: $SRC -> $DST"
        }
    else
        log "Файл-джерело не знайдено: $SRC"
    fi
}

# Початкова синхронізація одразу після завантаження
sync_file

# Якщо є inotifywait (busybox) — стежимо за файлом у реальному часі
if command -v inotifywait >/dev/null 2>&1; then
    log "Запускаю режим стеження через inotifywait"
    while true; do
        inotifywait -e close_write,modify,create,moved_to \
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
