#!/bin/bash
# Піднімає версію модуля.
# Використання:
#   ./scripts/bump_version.sh patch   # 0.0.001 -> 0.0.002
#   ./scripts/bump_version.sh minor   # 0.0.002 -> 0.1.000
#   ./scripts/bump_version.sh major   # 0.1.000 -> 1.0.000
#   ./scripts/bump_version.sh 1.2.3   # задати конкретну версію
set -e

# Auto-detect: if not running in Git Bash, re-exec via bash.exe
if [ -z "$MSYSTEM" ] && [ -z "$MINGW_CHOST" ]; then
  if command -v bash.exe >/dev/null 2>&1; then
    exec bash.exe "$0" "$@"
  fi
fi

PROP="module.prop"
JSON="update.json"
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys' >/dev/null 2>&1; then
    PY=$(command -v "$c")
    break
  fi
done
# Fallback: прямий пошук python.exe у типовому каталозі інсталяції (Windows)
if [ -z "$PY" ]; then
  PY=$(ls /c/Users/*/AppData/Local/Programs/Python/Python*/python.exe 2>/dev/null | head -n1)
fi
if [ -z "$PY" ]; then
  echo "Помилка: Python не знайдено. Встановіть Python або додайте його в PATH." >&2
  exit 1
fi

OLD_VER=$(grep -o '^version=.*' "$PROP" | cut -d= -f2)
OLD_VC=$(grep -o '^versionCode=.*' "$PROP" | cut -d= -f2)

IFS='.' read -r MAJ MIN PAT <<< "$OLD_VER"
PAT="${PAT:-0}"

case "$1" in
  major) MAJ=$((10#$MAJ + 1)); MIN=0; PAT=0 ;;
  minor) MIN=$((10#$MIN + 1)); PAT=0 ;;
  patch) PAT=$((10#$PAT + 1)) ;;
  [0-9]*.[0-9]*.[0-9]*) IFS='.' read -r MAJ MIN PAT <<< "$1" ;;
  "") echo "Помилка: вкажіть тип (major|minor|patch) або версію (X.Y.Z)"; exit 1 ;;
  *) echo "Помилка: невідомий тип '$1'"; exit 1 ;;
esac

NEW_VER="${MAJ}.${MIN}.$(printf '%03d' "$PAT")"
# versionCode = патч-компонент версії — узгоджено з release.yml, де
# versionCode обчислюється як останнє число версії (0.0.305 -> 305).
NEW_VC=$((10#$PAT))

# Оновлюємо module.prop
sed -i "s/^version=.*/version=${NEW_VER}/" "$PROP"
sed -i "s/^versionCode=.*/versionCode=${NEW_VC}/" "$PROP"

# Оновлюємо update.json + додаємо заголовок нової версії у changelog.md.
# Python замість sed для changelog: гарантовано зберігає UTF-8 (емодзі в
# описі) та LF-закінчення рядків на Windows.
"$PY" - "$JSON" "$NEW_VER" <<'EOF'
import json, sys
path, ver = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data['version'] = ver
data['versionCode'] = int(ver.split('.')[-1])
data['zipUrl'] = f"https://github.com/sansej8989/td2tdr/releases/download/v{ver}/td2tdr_v{ver}.zip"
with open(path, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
EOF

# Заголовок у changelog.md: нова секція вставляється ПЕРШОЮ (зверху),
# лише якщо її ще немає (ідемпотентність при повторному запуску).
"$PY" - "changelog.md" "$NEW_VER" <<'EOF'
import sys
path, ver = sys.argv[1], sys.argv[2]
header = f"# v{ver}"
with open(path, encoding='utf-8', newline='') as f:
    content = f.read()
if header not in content.splitlines():
    # Вставляємо після верхнього титульного заголовка (# ...), якщо він є,
    # інакше — на початок файлу. Секція: заголовок + порожній рядок-плейсхолдер.
    lines = content.split('\n')
    if lines and lines[0].startswith('# ') and not lines[0].startswith('# v'):
        insert_at = 1
        while insert_at < len(lines) and lines[insert_at].strip() == '':
            insert_at += 1
    else:
        insert_at = 0
    lines[insert_at:insert_at] = ['', '', header, '- ']
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))
EOF

echo "v${OLD_VER} (code $((10#$OLD_VC))) -> v${NEW_VER} (code $NEW_VC)"
echo "Наступні кроки:"
echo "  1) Заповніть список змін під заголовком '# v${NEW_VER}' у changelog.md"
echo "  2) git add module.prop update.json changelog.md"
echo "  git commit -m \"chore: bump to v${NEW_VER}\""
echo "  git push origin master"
echo "  git tag v${NEW_VER}"
echo "  git push origin v${NEW_VER}"