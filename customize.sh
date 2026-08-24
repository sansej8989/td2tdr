SKIPUNZIP=0
set_perm_recursive "$MODPATH" 0 0 0755 0644
# Явно виставляємо права на виконання для ВСІХ скриптів модуля.
# Спершу відомий список, потім страховочний обхід по *.sh — щоб новий
# скрипт, доданий у майбутніх версіях, не залишився без +x.
for s in service.sh action.sh sync_now.sh set_locale.sh post-fs-data.sh; do
  [ -f "$MODPATH/$s" ] && set_perm "$MODPATH/$s" 0 0 0755
done
for s in "$MODPATH"/*.sh; do
  [ -f "$s" ] && chmod 0755 "$s" 2>/dev/null
done

OUTFD=${OUTFD:-1}
VER=$(grep -o 'version=.*' "$MODPATH/module.prop" 2>/dev/null | cut -d= -f2)

# ── Персистентна тека даних користувача ────────────────────
# Створюємо ЗАВЖДИ (не лише під час міграції): історія аналітики,
# мова/тема та логи живуть тут і не стираються при оновленні модуля.
NEW_DATA_DIR="/storage/emulated/0/Download/td2tdr_sync"
mkdir -p "$NEW_DATA_DIR" 2>/dev/null
chmod 0775 "$NEW_DATA_DIR" 2>/dev/null
chown 1023:1023 "$NEW_DATA_DIR" 2>/dev/null || chown media_rw:media_rw "$NEW_DATA_DIR" 2>/dev/null
restorecon "$NEW_DATA_DIR" 2>/dev/null || chcon u:object_r:media_rw_data_file:s0 "$NEW_DATA_DIR" 2>/dev/null

# ── Одноразова міграція (тільки при оновленні з build, де ці файли
#    лежали в теці модуля — вона стирається на кожному оновленні).
#    Виконуємо ЗАРАЗ, поки стара тека модуля ще жива на диску (до свопу
#    при наступному завантаженні), і копіюємо напряму в персистентну
#    теку на /sdcard, яку оновлення більше не чіпають.
OLD_MOD="/data/adb/modules/td2tdr_sync"
if [ -d "$OLD_MOD" ]; then
  for f in history.jsonl locale theme ui_lang; do
    if [ -f "$OLD_MOD/$f" ] && [ ! -f "$NEW_DATA_DIR/$f" ]; then
      cp -f "$OLD_MOD/$f" "$NEW_DATA_DIR/$f" 2>/dev/null && \
        ui_print "↪ Перенесено $f у постійне сховище" || true
    fi
  done
fi

# Fallback abort, якщо середовище його не надає
if ! command -v abort >/dev/null 2>&1; then
  abort() {
    ui_print "! Аварійне завершення"
    exit 1
  }
fi

# Скидаємо буфер logcat одразу — далі ловимо лише натискання,
# зроблені під час показу цього інсталятора
if command -v logcat >/dev/null 2>&1; then
  logcat -c 2>/dev/null
fi

# Примітка: KernelSU-Next склеює послідовні ui_print, тому
# після КОЖНОГО рядка ставимо роздільник ui_print " "

# ── Зчитування клавіш ─────────────────────────────────────
# Повертає: 115 = Volume+, 116 = Volume-, 100 = таймаут (5с)
keycheck() {
  local LINE
  local count=0

  if command -v logcat >/dev/null 2>&1; then
    # 1) Рані натискання (зроблені поки друкувався текст) — вже в буфері
    LINE=$(logcat -d 2>/dev/null | grep -E -i "volume_up|volume_down|keycode_volume_up|keycode_volume_down|key 24|key 25|key_volumeup|key_volumedown" | tail -n 1)
    if [ -n "$LINE" ]; then
      logcat -c 2>/dev/null
      if echo "$LINE" | grep -qE -i "volume_up|key 24|keycode_volume_up|key_volumeup"; then
        return 115
      elif echo "$LINE" | grep -qE -i "volume_down|key 25|keycode_volume_down|key_volumedown"; then
        return 116
      fi
    fi

    # 2) Нових подій немає — чистимо буфер і слухаємо 5с
    logcat -c 2>/dev/null
    while true; do
      LINE=$(logcat -d 2>/dev/null | grep -E -i "volume_up|volume_down|keycode_volume_up|keycode_volume_down|key 24|key 25|key_volumeup|key_volumedown" | tail -n 1)
      if [ -n "$LINE" ]; then
        logcat -c 2>/dev/null
        if echo "$LINE" | grep -qE -i "volume_up|key 24|keycode_volume_up|key_volumeup"; then
          return 115
        elif echo "$LINE" | grep -qE -i "volume_down|key 25|keycode_volume_down|key_volumedown"; then
          return 116
        fi
      fi
      sleep 0.2
      count=$((count + 1))
      if [ $count -ge 25 ]; then
        return 100
      fi
    done
  fi

  # Magisk fallback: читаємо символ напряму
  while read -r key < "$OUTFD" 2>/dev/null; do
    case "$key" in
      "+"|"VOL_UP"|"y"|"Y") return 115 ;;
      "-"|"VOL_DOWN"|"n"|"N") return 116 ;;
      *) : ;;
    esac
  done
  return 100
}

# ── Вибір Так/Ні ──────────────────────────────────────────
#  [ Volume+ ] = перемикає Так / Ні
#  [ Volume- ] = підтвердити поточний вибір
#  Повертає 0 = Так, 1 = Ні
choose_yn() {
  local choice=no

  # Одразу показуємо поточний вибір (за замовчуванням: Ні)
  ui_print " "
  ui_print "Поточний вибір: [2] Ні (скасувати)"
  ui_print " "

  while true; do
    keycheck
    local KEY=$?

    if [ $KEY -eq 115 ]; then
      # Перемикання
      if [ "$choice" = no ]; then
        choice=yes
      else
        choice=no
      fi
      ui_print " "
      if [ "$choice" = yes ]; then
        ui_print "Поточний вибір: [1] Так"
      else
        ui_print "Поточний вибір: [2] Ні (скасувати)"
      fi
      ui_print " "
    elif [ $KEY -eq 116 ]; then
      # Підтвердження
      if [ "$choice" = yes ]; then
        return 0
      else
        return 1
      fi
    else
      ui_print " "
      ui_print "Таймаут 5 с. Вибір: [2] Ні (скасування)."
      ui_print " "
      return 1
    fi
  done
}

# ── Перевірка середовища ──────────────────────────────────
ui_print " "
ui_print "🔍 ПЕРЕВІРКА СЕРЕДОВИЩА"
ui_print " "

# Версія Android (SDK)
ANDROID_REL=$(getprop ro.build.version.release 2>/dev/null)
ANDROID_SDK=$(getprop ro.build.version.sdk 2>/dev/null)
if [ -n "$ANDROID_REL" ]; then
  ui_print "  📱 Android $ANDROID_REL (API $ANDROID_SDK)"
else
  ui_print "  ⚠️ Не вдалося визначити версію Android"
fi
ui_print " "

# Попередження для дуже старих Android (LocaleManager потребує API 33+,
# але модуль деградує gracefully — тому лише попередження, не abort)
if [ -n "$ANDROID_SDK" ] && [ "$ANDROID_SDK" -lt 33 ] 2>/dev/null; then
  ui_print "  ⚠️ Зміна мови гри потребує Android 13+"
  ui_print "     (інші функції працюватимуть)"
  ui_print " "
fi

# Root-менеджер
ROOT_MGR="невідомий"
if [ -n "$KSU_VER" ] || [ "$KSU" = "true" ] || [ -n "$KSU_KERNEL_VER_CODE" ]; then
  ROOT_MGR="KernelSU"
elif [ -n "$MAGISK_VER" ] || [ -n "$MAGISK_VER_CODE" ]; then
  ROOT_MGR="Magisk $MAGISK_VER"
fi
ui_print "  🔑 Root: $ROOT_MGR"
ui_print " "

# Наявність гри (інформаційно, НЕ блокує встановлення)
GAME_PKG="com.hutchgames.cccg"
GAME_FOUND=""
if command -v pm >/dev/null 2>&1; then
  GAME_FOUND=$(pm path "$GAME_PKG" 2>/dev/null | head -n 1)
fi
if [ -n "$GAME_FOUND" ]; then
  ui_print "  🎮 Гра Top Drives знайдена ✅"
else
  ui_print "  ⚠️ Гра ($GAME_PKG) не знайдена —"
  ui_print "     встановіть гру перед використанням"
fi
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print " "

# ── Шапка ─────────────────────────────────────────────────
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print " "
ui_print "⚠️  td2tdr v$VER"
ui_print " "
ui_print "🚗 Top Drives · Garage Sync Module"
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print " "

# ── Дисклеймер ───────────────────────────────────────────
ui_print "⚠️  ДИСКЛЕЙМЕР"
ui_print " "
ui_print "Модуль надається «як є» (AS IS)."
ui_print " "
ui_print "Автор не несе відповідальності за:"
ui_print " "
ui_print "  🗂️  втрату або пошкодження Garage.dat"
ui_print " "
ui_print "  🎮  збої або помилки гри Top Drives"
ui_print " "
ui_print "  📱  будь-які проблеми з пристроєм"
ui_print " "
ui_print "Використовуючи модуль, ви приймаєте"
ui_print " "
ui_print "ці умови на свій власний ризик."
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print " "

# ── Підтвердження ────────────────────────────────────────
ui_print "🎯 Продовжити встановлення модуля?"
ui_print " "
ui_print "  🔊 [ Volume+ ]  перемикає Так / Ні"
ui_print " "
ui_print "  🔉 [ Volume- ]  підтвердити вибір"
ui_print " "
ui_print "  ⏱️  (таймаут 5с = скасування)"
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

choose_yn
if [ $? -ne 0 ]; then
  ui_print " "
  ui_print "🛑 Встановлення скасовано."
  ui_print " "
  ui_print "Модуль не буде встановлено."
  ui_print " "
  rm -rf "$MODPATH"
  abort
fi

# ── Встановлення ─────────────────────────────────────────
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print " "
ui_print "📦 ВСТАНОВЛЕННЯ"
ui_print " "
ui_print "  ✅ service.sh          готово"
ui_print " "
ui_print "  ✅ WebUI (webroot)     готово"
ui_print " "
ui_print "  ✅ Банер               готово"
ui_print " "
ui_print "  ✅ Права скриптів      0755"
ui_print " "
ui_print "  🗂️ Дані користувача    збережено"
ui_print "     (Download/td2tdr_sync)"
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print " "
ui_print "🔄 Після перезавантаження Garage.dat"
ui_print " "
ui_print "буде синхронізовано у /Download/td2tdr_sync"
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print " "
ui_print "📡 ЗВ'ЯЗОК З АВТОРОМ"
ui_print " "
ui_print "  👤 Автор: @sansej89 (t.me/sansej89)"
ui_print " "
ui_print "  📰 Канал новин Top Drives:"
ui_print " "
ui_print "     @topdrives_ua (t.me/topdrives_ua)"
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print " "
ui_print "✨ Дякуємо за встановлення!"
ui_print " "
ui_print "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ui_print " "

# ── Відкриваємо Telegram-канал (можна вимкнути файлом-прапорцем) ──
if [ ! -f "$MODPATH/.no_channel_redirect" ]; then
  nohup am start -a android.intent.action.VIEW -d "https://t.me/topdrives_ua" -c android.intent.category.BROWSABLE >/dev/null 2>&1 &
fi