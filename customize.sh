SKIPUNZIP=0
set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/service.sh" 0 0 0755

OUTFD=${OUTFD:-1}
VER=$(grep -o 'version=.*' "$MODPATH/module.prop" 2>/dev/null | cut -d= -f2)

# ── Fallback abort ─────────────────────────────────────────
if ! command -v abort >/dev/null 2>&1; then
  abort() {
    ui_print " ! Аварійне завершення"
    exit 1
  }
fi

# ── Вибір Так/Ні ──────────────────────────────────────────
# [ Volume+ ] перемикає вибір на "Так"
# [ Volume- ] підтверджує поточний вибір
# За замовчуванням: "Ні" (скасування)
# Повертає 0 = Так, 1 = Ні.
choose_yn() {
  choice=no
  while true; do
    read -r key < "$OUTFD" 2>/dev/null || break
    case "$key" in
      "+"|"VOL_UP"|"y"|"Y")
        choice=yes
        ui_print ""
        ui_print "  Відповідь: ТАК"
        ;;
      "-"|"VOL_DOWN"|"n"|"N")
        if [ "$choice" = yes ]; then
          return 0
        else
          return 1
        fi
        ;;
      *)
        ui_print ""
        ui_print "  ! Невідома клавіша. Використовуйте Volume+ / Volume-"
        ;;
    esac
  done
  return 1
}

# ── Шапка ─────────────────────────────────────────────────
ui_print ""
ui_print "  +------------------------------------------+"
ui_print "  |        td2tdr  v${VER}                    |"
ui_print "  |    Top Drives Garage Sync Module         |"
ui_print "  +------------------------------------------+"
ui_print ""

# ── Дисклеймер ───────────────────────────────────────────
ui_print "  +------------------------------------------+"
ui_print "  |             ДИСКЛЕЙМЕР                    |"
ui_print "  +------------------------------------------+"
ui_print ""
ui_print "  Модуль надається «як є» (AS IS)."
ui_print "  Автор не несе відповідальності за:"
ui_print ""
ui_print "   * втрату або пошкодження Garage.dat"
ui_print "   * збої або помилки гри Top Drives"
ui_print "   * будь-які проблеми з пристроєм"
ui_print ""
ui_print "  Використовуючи модуль, ви приймаєте"
ui_print "  ці умови на свій власний ризик."
ui_print ""

# ── Підтвердження ────────────────────────────────────────
ui_print "  +------------------------------------------+"
ui_print "  |   Продовжити встановлення модуля?        |"
ui_print "  |                                          |"
ui_print "  |   [ Volume+ ] = Так                      |"
ui_print "  |   [ Volume- ] = Підтвердити вибір        |"
ui_print "  |                                          |"
ui_print "  |   За замовчуванням: НІ (скасувати)       |"
ui_print "  +------------------------------------------+"

if ! choose_yn; then
  ui_print ""
  ui_print "  ! Встановлення скасовано."
  ui_print "  Модуль не буде встановлено."
  rm -rf "$MODPATH"
  abort
fi

# ── Встановлення ─────────────────────────────────────────
ui_print ""
ui_print "  +------------------------------------------+"
ui_print "  |         Встановлення етапів              |"
ui_print "  +------------------------------------------+"
ui_print ""
ui_print "  [*] service.sh              готово"
ui_print "  [*] WebUI (webroot)         готово"
ui_print "  [*] Банер / іконка          готово"
ui_print ""
ui_print "  Після перезавантаження:"
ui_print "  Garage.dat буде синхронізовано"
ui_print "  у /Download/td2tdr_sync"
ui_print ""
ui_print "  Дякуємо за встановлення!"