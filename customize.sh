SKIPUNZIP=0
set_perm_recursive "$MODPATH" 0 0 0755 0644
set_perm "$MODPATH/service.sh" 0 0 0755

# ── Привітання ──────────────────────────────────────────────
ui_print "╔══════════════════════════════════════╗"
ui_print "║           🏁  td2tdr  🏁             ║"
ui_print "║     Top Drives Garage Sync Module    ║"
ui_print "╚══════════════════════════════════════╝"
ui_print ""
ui_print "  v$(grep -o 'version=.*' "$MODPATH/module.prop" | cut -d= -f2)"
ui_print ""
ui_print "  [✓] service.sh              готова"
ui_print "  [✓] WebUI (webroot)         на місці"
ui_print "  [✓] Банер / іконка         встановлені"
ui_print ""
ui_print "  Після перезавантаження"
ui_print "  Garage.dat синхронізується"
ui_print "  у /Download/td2tdr_sync"
ui_print ""
ui_print "  Дякуємо за встановлення! 🎉"