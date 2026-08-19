#!/system/bin/sh
# set_locale.sh — Patch cached SharedPreferences language keys as a fallback
# to the primary mechanism (Android per-app LocaleManager, applied separately
# via `cmd locale set-app-locales` in service.sh / webroot/app.js).
#
# Usage: set_locale.sh [locale]
#   locale: e.g. "ru_RU", "en_US". If omitted, reads from ${MODDIR}/locale.
#   If neither is set, defaults to ru_RU.

MODDIR="${0%/*}"
GAME_PKG="com.hutchgames.cccg"
SHARED_PREFS="/data/data/${GAME_PKG}/shared_prefs"
LOG="${MODDIR}/sync.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [locale] $1" >> "$LOG"
}

# Determine target locale (full form e.g. "ru_RU")
if [ -n "$1" ]; then
    TARGET="$1"
elif [ -f "${MODDIR}/locale" ] && [ -s "${MODDIR}/locale" ]; then
    TARGET=$(cat "${MODDIR}/locale")
else
    TARGET="ru_RU"
fi

[ -z "$TARGET" ] && exit 0

# Derive short code: "ru_RU" -> "ru", "en_US" -> "en"
SHORT=$(echo "$TARGET" | cut -d_ -f1)
# Derive UPPER short for M2H_lastLanguage: "ru" -> "RU", "en" -> "EN"
UPPER=$(echo "$SHORT" | tr '[:lower:]' '[:upper:]')

if [ ! -d "$SHARED_PREFS" ]; then
    log "shared_prefs not found: $SHARED_PREFS"
    exit 1
fi

log "Setting locale to: $TARGET (short=$SHORT, upper=$UPPER)"

# --- Target 1: FBAdPrefs.xml — LAST_SAVED_LOCALE (lowercase short code) ---
AD_PREFS="${SHARED_PREFS}/FBAdPrefs.xml"
if [ -f "$AD_PREFS" ]; then
    if sed -i \
        "s|\(<string name=\"LAST_SAVED_LOCALE\">\)[A-Za-z][A-Za-z]\(</string>\)|\1${SHORT}\2|g" \
        "$AD_PREFS" 2>/dev/null; then
        if grep -q ">$SHORT<" "$AD_PREFS" 2>/dev/null; then
            log "Modified LAST_SAVED_LOCALE in FBAdPrefs.xml -> $SHORT"
        else
            log "LAST_SAVED_LOCALE sed ran but value not found — check FBAdPrefs.xml format"
        fi
    fi
else
    log "FBAdPrefs.xml not found"
fi

# --- Target 2: playerprefs.xml — M2H_lastLanguage (uppercase short code) ---
# Real on-device filename confirmed from diagnostics: com.hutchgames.cccg.v2.playerprefs.xml
FOUND_PLAYERPREFS=0
for PREFS_FILE in \
    "${SHARED_PREFS}/com.hutchgames.cccg.v2.playerprefs.xml" \
    "${SHARED_PREFS}/com.hutchgames.cccg.v2.player_preferences.xml" \
    "${SHARED_PREFS}/com.hutchgames.cccg.player_preferences.xml" \
    "${SHARED_PREFS}/com.hutchgames.racegame.v2.player_preferences.xml"; do
    if [ -f "$PREFS_FILE" ]; then
        FOUND_PLAYERPREFS=1
        if sed -i \
            "s|\(<string name=\"M2H_lastLanguage\">\)[A-Z][A-Z]\{0,4\}\(</string>\)|\1${UPPER}\2|g" \
            "$PREFS_FILE" 2>/dev/null; then
            if grep -q ">$UPPER<" "$PREFS_FILE" 2>/dev/null; then
                log "Modified M2H_lastLanguage in $(basename "$PREFS_FILE") -> $UPPER"
            else
                log "M2H_lastLanguage sed ran but value not found — check format"
            fi
        fi
        break
    fi
done

if [ "$FOUND_PLAYERPREFS" = "0" ]; then
    log "playerprefs.xml not found under any known name — game may not have run yet"
fi

log "Done"
