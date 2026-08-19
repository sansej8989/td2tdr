#!/system/bin/sh
# post-fs-data.sh — Patch cached SharedPreferences language keys early,
# before the game process can start. This is a fallback; the primary
# per-app locale mechanism (cmd locale set-app-locales) runs later in
# service.sh, since it needs system_server to be up.

MODDIR="${0%/*}"
sh "${MODDIR}/set_locale.sh"

# Safety: if the game happens to already be running (rare at this boot stage),
# kill it so a later manual launch reads the freshly patched prefs.
GAME_PKG="com.hutchgames.cccg"
if pidof "$GAME_PKG" >/dev/null 2>&1; then
  killall "$GAME_PKG" 2>/dev/null || kill $(pidof "$GAME_PKG") 2>/dev/null
fi
