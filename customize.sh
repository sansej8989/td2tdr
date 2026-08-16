SKIPUNZIP=0
set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/service.sh" 0 0 0755

OUTFD=${OUTFD:-1}
VER=$(grep -o 'version=.*' "$MODPATH/module.prop" 2>/dev/null | cut -d= -f2)

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
#  [ Volume- ] = підтверджує поточний вибір
#  Повертає 0 = Так, 1 = Ні
choose_yn() {
  local choice=no

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
        ui_print "  > [1] Так"
        ui_print "    [2] Ні"
      else
        ui_print "    [1] Так"
        ui_print "  > [2] Ні"
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
      ui_print "! Таймаут. Вибір за замовчуванням: Ні (скасування)."
      return 1
    fi
  done
}

# ── Шапка ─────────────────────────────────────────────────
ui_print " "
ui_print "td2tdr v$VER"
ui_print "Top Drives Garage Sync Module"
ui_print "-------------------------------------------"

# ── Дисклеймер ───────────────────────────────────────────
ui_print "-------------------------------------------"
ui_print "ДИСКЛЕЙМЕР"
ui_print "-------------------------------------------"
ui_print "Модуль надається «як є» (AS IS)."
ui_print "Автор не несе відповідальності за:"
ui_print " "
ui_print "  * втрату або пошкодження Garage.dat"
ui_print "  * збої або помилки гри Top Drives"
ui_print "  * будь-які проблеми з пристроєм"
ui_print " "
ui_print "Використовуючи модуль, ви приймаєте"
ui_print "ці умови на свій власний ризик."

# ── Підтвердження ────────────────────────────────────────
ui_print "-------------------------------------------"
ui_print "Продовжити встановлення модуля?"
ui_print " "
ui_print "  [ Volume+ ] = перемикає Так / Ні"
ui_print "  [ Volume- ] = підтвердити вибір"
ui_print "  (за замовчуванням: Ні, таймаут 5 с)"
ui_print "-------------------------------------------"

choose_yn
if [ $? -ne 0 ]; then
  ui_print " "
  ui_print "! Встановлення скасовано."
  ui_print "Модуль не буде встановлено."
  rm -rf "$MODPATH"
  abort
fi

# ── Встановлення ─────────────────────────────────────────
ui_print " "
ui_print "-------------------------------------------"
ui_print "ВСТАНОВЛЕННЯ"
ui_print "-------------------------------------------"
ui_print " "
ui_print "  [*] service.sh          готово"
ui_print "  [*] WebUI (webroot)     готово"
ui_print "  [*] Банер / іконка      готово"
ui_print " "
ui_print "Після перезавантаження Garage.dat"
ui_print "буде синхронізовано у /Download/td2tdr_sync"
ui_print " "
ui_print "Дякуємо за встановлення!"
ui_print " "