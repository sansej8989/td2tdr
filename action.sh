#!/system/bin/sh
# ------------------------------------------------------------------
# "Дія" (Action) button — executed when tapped in the root manager.
# Opens the td2tdr Telegram channel in the system browser.
# ------------------------------------------------------------------

ui_print() { echo "$1"; }

CHANNEL_URL="https://t.me/topdrives_ua"

am start -a android.intent.action.VIEW -d "$CHANNEL_URL" -c android.intent.category.BROWSABLE >/dev/null 2>&1

if [ $? -eq 0 ]; then
  ui_print "📰 Відкрито канал: $CHANNEL_URL"
else
  ui_print "⚠ Не вдалося відкрити посилання. Перейдіть вручну: $CHANNEL_URL"
fi

exit 0
