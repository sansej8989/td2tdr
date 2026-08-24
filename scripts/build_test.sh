#!/bin/bash
# Локальна тестова збірка модуля.
# Не чіпає module.prop, update.json, теги і репо — публічна версія не змінюється.
# Використання:
#   ./scripts/build_test.sh          # alpha за замовчуванням
#   ./scripts/build_test.sh alpha
#   ./scripts/build_test.sh beta
set -e

# Auto-detect: if not running in Git Bash, re-exec via bash.exe
if [ -z "$MSYSTEM" ] && [ -z "$MINGW_CHOST" ]; then
  if command -v bash.exe >/dev/null 2>&1; then
    exec bash.exe "$0" "$@"
  fi
fi

LABEL="${1:-alpha}"
case "$LABEL" in
  alpha|beta) ;;
  *) echo "Помилка: мітка '$LABEL' невідома. Використовуйте: alpha|beta"; exit 1 ;;
esac

PROP="module.prop"
DIST="dist"
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys' >/dev/null 2>&1; then
    PY=$(command -v "$c")
    break
  fi
done
if [ -z "$PY" ]; then
  PY=$(ls /c/Users/*/AppData/Local/Programs/Python/Python*/python.exe 2>/dev/null | head -n1)
fi
if [ -z "$PY" ]; then
  echo "Помилка: Python не знайдено. Встановіть Python або додайте його в PATH." >&2
  exit 1
fi

VER=$(grep -o '^version=.*' "$PROP" | cut -d= -f2)
if [ -z "$VER" ]; then
  echo "Помилка: не знайдено version у $PROP" >&2
  exit 1
fi

mkdir -p "$DIST"
ZIP="$DIST/td2tdr_v${VER}-${LABEL}.zip"
rm -f "$ZIP"

"$PY" - "$ZIP" <<'EOF'
import os, sys, zipfile
OUT = sys.argv[1]
EXCLUDE = {'.git', '.github', 'dist', 'temp'}
def skip(p):
    parts = p.replace('\\', '/').split('/')
    return any(x in EXCLUDE for x in parts) or p.endswith('.zip')
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if not skip(root + '/' + d)]
        for f in files:
            path = os.path.join(root, f).replace('\\', '/')
            if not skip(path):
                z.write(path)
EOF

SHA="$("$PY" -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$ZIP")"

echo "Готово: $ZIP"
echo "  sha256: $SHA"
echo "Встановити на телефон: Magisk/KernelSU → Модулі → Встановити з файлу → $ZIP"