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
import os, stat, sys, zipfile
OUT = sys.argv[1]
# Виключаємо: службові теки репозиторію, скрипти розробника, метадані
# npm/git і документацію — в архів мають потрапити ЛИШЕ файли модуля
# (module.prop, customize.sh, *.sh, webroot/, banner).
EXCLUDE_DIRS = {'.git', '.github', 'dist', 'temp', 'scripts', 'node_modules'}
EXCLUDE_FILES = {'.gitignore', '.gitattributes', 'package.json', 'package-lock.json',
                 'README.md'}
EXEC_FILES = {'customize.sh', 'service.sh', 'sync_now.sh', 'set_locale.sh',
              'action.sh', 'post-fs-data.sh'}

def skip(p):
    parts = p.replace('\\', '/').split('/')
    name = parts[-1]
    return (any(x in EXCLUDE_DIRS for x in parts)
            or name in EXCLUDE_FILES
            or name.endswith('.zip')
            or name.endswith('.sha256'))

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if not skip(root + '/' + d)]
        for f in files:
            path = os.path.join(root, f).replace('\\', '/')
            if skip(path):
                continue
            # POSIX-права в zip задаються через external_attr (unix mode << 16).
            # Без цього Python zipfile кладе 0644 всім файлам, і після
            # розпакування на пристрої скрипти втрачають exec-біт.
            name = os.path.basename(path)
            mode = 0o755 if name in EXEC_FILES else 0o644
            zi = zipfile.ZipInfo.from_file(path, path[2:] if path.startswith('./') else path)
            zi.external_attr = (stat.S_IFREG | mode) << 16
            with open(path, 'rb') as src:
                z.writestr(zi, src.read(), zipfile.ZIP_DEFLATED)
EOF

SHA="$("$PY" -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$ZIP")"

echo "Готово: $ZIP"
echo "  sha256: $SHA"
echo "Встановити на телефон: Magisk/KernelSU → Модулі → Встановити з файлу → $ZIP"