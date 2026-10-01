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

# ----- v0.0.614: PID-lock проти паралельних запусків -----
# WebUI «Синхронізувати та відкрити» запускає цей скрипт у фоні і не чекає
# завершення, тому другий клік (або вже запущений service.sh) піднімав
# паралельний процес, який змагався б за файли копій та запис історії.
# `mkdir` атомарний і не потребує flock (якого на Android може не бути).
LOCK_DIR="${TMPDIR:-/data/local/tmp}/td2tdr_sync.lock"

acquire_lock() {
    local attempt=0 owner=""
    while [ "$attempt" -lt 2 ]; do
        if mkdir "$LOCK_DIR" 2>/dev/null; then
            echo "$$" > "$LOCK_DIR/pid" 2>/dev/null
            # Знімаємо блокування на будь-який вихід, включно з exit/error.
            trap 'rm -rf "$LOCK_DIR" 2>/dev/null' EXIT INT TERM
            return 0
        fi
        # Протухле блокування (власник убитий/перезавантаження) — перехоплюємо.
        owner=$(cat "$LOCK_DIR/pid" 2>/dev/null)
        if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
            log "PID-lock: процес $owner більше не живий — перехоплюємо блокування"
            rm -rf "$LOCK_DIR" 2>/dev/null
            attempt=$((attempt + 1))
            continue
        fi
        break
    done
    return 1
}

if ! acquire_lock; then
    log "PID-lock: попередній sync_now.sh ще виконується — запуск пропущено"
    echo "sync already in progress" >&2
    exit 0
fi

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
    # v0.0.615: унікальний tmp на кожен запуск ($$ = PID). Раніше шлях був
    # фіксованим (history.jsonl.tmp), тому WebUI saveHistory() і цей скрипт
    # конкурували за той самий файл: `rm -f` одного з процесів зносив файл,
    # який інший уже записав, а `mv -f` переносив обрізаний вміст у history.jsonl.
    # PID-суфікс робить файли неперетинними між процесами.
    local HISTORY_TMP="$HISTORY.tmp.$$"
    local HISTORY_ALT_TMP="$HISTORY_ALT.tmp.$$"
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

# Garage: PlayerDeck=<hex>,s<JSON-array>; картки мають поля `locked` та `state`.
     # Витягуємо JSON-частину через sed і рахуємо масив ПОЕЛЕМЕНТНО.
     #   state:1 = в гаражі (slots), state:0 = в триманні (held/under garage)
     #   locked:true = заблоковані/зберігаються, locked:false = розблоковані
     # Метрики:
     #   garageCapacity — справжня місткість, якої НЕМАЄ в PlayerDeck (аудит
     #     двох справжніх експортів: жодного slots/maxSlots/capacity). Тому вона
     #     зберігається в history.jsonl і лікується лише ВГОРУ.
     #   garageTotal    = garageCapacity (legacy-поле для графіка/імпорту)
     #   garageLocked   = state:1 І locked:true (лише ті, що займають слот)
     #   garageFree     = garageCapacity - garageLocked
     #   garageHeld     = state:0
     # v0.0.619 (аудит): глобальний grep по '"locked":true' рахував locked
     # у ВСІХ станах, включно з машинами «у триманні» (state:0), які
     # гаражного слоту не займають → «заблоковані» завищені, а «вільно»
     # (total - locked) занижені. Щоб узяти locked і state з ТІЄІ самої
     # картки, рахуємо елементи масиву окремо: awk обходить рядок і
     # збирає буфер кожного об'єкта верхнього рівня (глибина 2), ігноруючи
     # вкладені об'єкти/масиви. Те саме, що робить WebUI у
     # getGarageSnapshot() через cards.filter(...).
     # Якщо awk недоступний/спіткнувся — degrades до глобального підрахунку
     # (WebUI перезапише сьогоднішній рядок точними значеннями).
     # ВАЖЛИВО: збережену місткість читаємо з ПОВНОГО файлу історії,
     # включно із сьогоднішнім рядком — інакше ручний ввід із WebUI, який
     # живе лише в сьогоднішньому рядку, затерся б dedup'ом нижче.
     local G_TOTAL G_LOCKED G_STATE1 G_STATE0 G_CAPACITY=""
     # v0.0.634: збережена місткість — останнє garageCapacity у файлі історії.
     # Читаємо ДО dedup'у (тобто з повного файлу, включно із сьогоднішнім
     # рядком), щоб ручний ввід із WebUI пережив наступну синхронізацію.
     if [ -f "$HISTORY" ]; then
         G_CAPACITY=$(grep -o '"garageCapacity"[[:space:]]*:[[:space:]]*[0-9]*' "$HISTORY" 2>/dev/null | tail -n1 | grep -o '[0-9]*$')
     fi
     if [ -f "$GARAGE_FILE" ]; then
         local DECK_JSON
         DECK_JSON=$(grep -oE '^PlayerDeck=[^,]+,s\[.*\]' "$GARAGE_FILE" 2>/dev/null | head -n1 | sed -E 's/^PlayerDeck=[^,]+,s//')
         if [ -n "$DECK_JSON" ]; then
             local G_COUNTS
             G_COUNTS=$(printf '%s' "$DECK_JSON" | awk '
                 function flush(   s) {
                     s = buf
                     if (s ~ /"state"[[:space:]]*:[[:space:]]*1[[:space:]]*[,}]/) {
                         n1++
                         if (s ~ /"locked"[[:space:]]*:[[:space:]]*true/) l1++
                     } else if (s ~ /"state"[[:space:]]*:[[:space:]]*0[[:space:]]*[,}]/) {
                         n0++
                     }
                     buf = ""
                 }
                 {
                     depth = 0; buf = ""; n1 = 0; n0 = 0; l1 = 0
                     total = length($0)
                     for (i = 1; i <= total; i++) {
                         c = substr($0, i, 1)
                         if (c == "{" || c == "[") {
                             depth++
                             if (depth == 2) buf = ""
                         } else if (c == "}" || c == "]") {
                             if (depth == 2) flush()
                             depth--
                             if (depth < 0) depth = 0
                         } else if (depth == 2) {
                             buf = buf c
                         }
                     }
                     if (depth >= 2) flush()
                     print n1, n0, l1
                 }' 2>/dev/null)
             if [ -n "$G_COUNTS" ]; then
                 G_STATE1=$(printf '%s' "$G_COUNTS" | cut -d' ' -f1)
                 G_STATE0=$(printf '%s' "$G_COUNTS" | cut -d' ' -f2)
                 G_LOCKED=$(printf '%s' "$G_COUNTS" | cut -d' ' -f3)
             fi
             # Fallback (awk недоступний): глобальний підрахунок ключів.
             if [ -z "$G_LOCKED" ]; then
                 G_LOCKED=$(printf '%s' "$DECK_JSON" | grep -oE '"locked":[[:space:]]*true' | wc -l | tr -d ' ')
                 [ -z "$G_STATE1" ] && G_STATE1=$(printf '%s' "$DECK_JSON" | grep -oE '"state":[[:space:]]*1[,}]' | wc -l | tr -d ' ')
                 [ -z "$G_STATE0" ] && G_STATE0=$(printf '%s' "$DECK_JSON" | grep -oE '"state":[[:space:]]*0[,}]' | wc -l | tr -d ' ')
fi
              # Зайняті слоти = state:1 (без жодного «+1»).
              if [ -n "$G_STATE1" ]; then
                  G_OCCUPIED="$G_STATE1"
              else
                  G_OCCUPIED=$(printf '%s' "$DECK_JSON" | grep -oE '"locked":[[:space:]]*(true|false)' | wc -l | tr -d ' ')
              fi
              # v0.0.634: місткість лікується лише вгору —
              # max(збережена ?? occupied+1, occupied). Старе встановлення
              # (occupied+1) працює як фолбек, поки справжнє число невідоме.
              # Відоме обмеження: якщо гравець купить слоти й не заповнить їх,
              # occupied не зміниться, тож авто-лікування не побачить зростання —
              # число залишиться застарілим до ручного виправлення (див. WebUI).
              if [ -n "$G_CAPACITY" ] && [ "$G_CAPACITY" -gt 0 ] 2>/dev/null; then
                  G_CAPACITY_BASE="$G_CAPACITY"
              else
                  G_CAPACITY_BASE=$((G_OCCUPIED + 1))
              fi
              if [ "$G_OCCUPIED" -gt "$G_CAPACITY_BASE" ]; then
                  G_CAPACITY="$G_OCCUPIED"
              else
                  G_CAPACITY="$G_CAPACITY_BASE"
              fi
              G_TOTAL="$G_CAPACITY"
          fi
      fi

    # --- 2. Patch I в shell: захист від порожнього знімка ---
     if [ -z "$CASH$GLD$PRESTIGE$G_TOTAL" ]; then
         log "WARN: history snapshot — усі ресурси порожні (user.dat пошкоджений?), знімок пропущено"
         return 0
     fi

     # v0.0.606/v0.0.612: монотонне обмеження garageLocked/garageTotal
     # прибрано разом із відповідними межами у WebUI. «Місткість» тут —
     # похідна величина від кількості машин (state:1 + 1), а garageLocked
     # не монотонний узагалі: розблокування машини зменшує його. Підміна
     # фактичного значення попереднім максимумом робила лічильники
     # неспадними назавжди — один продаж/злиття «заморожував» метрики, а
     # динаміка приросту втрачала реальні спади.

     # --- 3. Побудувати JSON-рядок нового запису ---
     # Уникаємо залежностей від jq: формуємо вручну через printf.
     # v0.0.619: garageFree тепер пишеться явно. Раніше поле не записувалося
     # взагалі, тож WebUI відновлював його через total - locked — уже без
     # фільтра за state, тобто «вільні слоти» були систематично занижені.
     local ENTRY G_FREE=""
     ENTRY=$(printf '{"date":"%s","ts":%s' "$TODAY" "$NOW_TS")
     [ -n "$CASH" ]     && ENTRY=$(printf '%s,"cash":%s'     "$ENTRY" "$CASH")
     [ -n "$GLD" ]      && ENTRY=$(printf '%s,"gold":%s'      "$ENTRY" "$GLD")
     [ -n "$PRESTIGE" ] && ENTRY=$(printf '%s,"prestige":%s' "$ENTRY" "$PRESTIGE")
     [ -n "$G_CAPACITY" ] && ENTRY=$(printf '%s,"garageCapacity":%s' "$ENTRY" "$G_CAPACITY")
      [ -n "$G_TOTAL" ]  && ENTRY=$(printf '%s,"garageTotal":%s'  "$ENTRY" "$G_TOTAL")
     [ -n "$G_LOCKED" ] && ENTRY=$(printf '%s,"garageLocked":%s' "$ENTRY" "$G_LOCKED")
     if [ -n "$G_TOTAL" ] && [ -n "$G_LOCKED" ]; then
         G_FREE=$((G_TOTAL - G_LOCKED))
         [ "$G_FREE" -lt 0 ] && G_FREE=0
         ENTRY=$(printf '%s,"garageFree":%s' "$ENTRY" "$G_FREE")
     fi
     [ -n "$G_STATE0" ] && ENTRY=$(printf '%s,"garageHeld":%s' "$ENTRY" "$G_STATE0")
     ENTRY="$ENTRY}"

    # --- 4. Дедуплікація: прочитати існуючий history.jsonl, видалити рядки з
    # сьогоднішньою датою, додати новий рядок, посортувати за датою (якщо
    # немає — просто створюємо новий файл). ---
    # v0.0.619: сортування реально виконується. Коментар про нього був ще
    # з v0.0.516, але код лише дописував рядок у кінець файлу, тому
    # history.jsonl міг лишатися нехронологічним (імпорт, зміна часового
    # поясу, ручне редагування). На ньому ламалися сусідні дельти в
    # WebUI: computeDelta()/buildChartSeries() беруть «попередній» запис
    # за позицією у файлі, а не за часом.
    # Ключ сортування — префікс "date":"YYYY-MM-DD" (ISO, тому лексикографічне
    # порядкове звірення = хронологічне). LC_ALL=C — щоб locale не ігнорував
    # розділювачі.
    local EXISTING=""
    if [ -f "$HISTORY" ]; then
        EXISTING=$(grep -v "\"date\":\"${TODAY}\"" "$HISTORY" 2>/dev/null || true)
    fi
    local NEW_CONTENT
    if [ -n "$EXISTING" ]; then
        # EXISTING вже містить \n на кінці (або ні, якщо файл без фінального
        # переведення рядка). Гарантуємо відсутність подвійного \n.
        NEW_CONTENT=$(printf '%s\n%s\n' "$EXISTING" "$ENTRY" | LC_ALL=C sort)
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
# v0.0.517: 8 ітерацій з поступовим зростанням паузи (0.3s → 0.5s) —
# захищає від повільного запису великого Garage.dat, коли 0.3с між
# знімками недостатньо для стабілізації розміру.
wait_stable() {
    # v0.0.617: пришвидшено. Було: до 8 ітерацій зі зростаючими паузами
    # 0.3→0.5с (гірший випадок 3.4с НА ФАЙЛ, ~6.8с на Garage.dat + user.dat).
    # Стало: короткі кроки 0.15с і вимога ТРЬОХ однакових замірів поспіль.
    # Типовий випадок (файл уже стабільний) — ~0.3с замість 0.3–0.5с,
    # гірший — ~0.9с замість 3.4с.
    local f="$1" s d prev i=0 max=6
    s=$(stat -c %s "$f" 2>/dev/null) || return 1
    [ -n "$s" ] && [ "$s" -gt 0 ] || return 1
    prev="$s"
    while [ "$i" -lt "$max" ]; do
        sleep 0.15 2>/dev/null || sleep 1
        d=$(stat -c %s "$f" 2>/dev/null) || return 1
        # Три однакові заміри поспіль = файл реально стабільний. Два лише
        # могли б збігтися випадково під час короткої паузи у флаші гри.
        if [ -n "$d" ] && [ "$d" = "$prev" ] && [ "$d" = "$s" ]; then
            echo "$s"
            return 0
        fi
        prev="$d"
        s="$d"
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
        # не дають shell писати в /data/media, але дають в /storage/emulated/0.
        # v0.0.517: чекаємо стабілізації джерела перед cp і перевіряємо
        # розмір копії, щоб унеможливити torn write.
        log "Верифікація не пройшла (${FINAL}) — пробую fallback у /storage"
        want=$(wait_stable "$EFF_SRC") || {
            log "Fallback: джерело ще не стабілізувалося, копіювання скасовано"
            echo "verify failed: source not stable for fallback" >&2
            exit 3
        }
        mkdir -p "/storage/emulated/0/Download/td2tdr_sync" 2>/dev/null
        if cp -f "$EFF_SRC" "$PUB_FINAL" 2>>"$LOG"; then
            got=$(stat -c %s "$PUB_FINAL" 2>/dev/null)
            if [ -n "$got" ] && [ "$got" = "$want" ] && [ "$got" -gt 0 ]; then
                chmod 0644 "$PUB_FINAL" 2>/dev/null
                chown 1023:1023 "$PUB_FINAL" 2>/dev/null || chown media_rw:media_rw "$PUB_FINAL" 2>/dev/null
                restorecon "$PUB_FINAL" 2>/dev/null || chcon u:object_r:media_rw_data_file:s0 "$PUB_FINAL" 2>/dev/null
                FINAL="$PUB_FINAL"
                SIZE="$got"
                log "Fallback-копіювання вдалось: $FINAL ($SIZE байт)"
                scan "Garage.dat"
            else
                rm -f "$PUB_FINAL"
                log "ПОМИЛКА: fallback розмір копії ($got) не збігається з джерелом ($want)"
                echo "verify failed: fallback size mismatch" >&2
                exit 3
            fi
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