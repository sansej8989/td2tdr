import sys

ver = sys.argv[1]
out, on = [], False
for line in open("changelog.md", encoding="utf-8"):
    s = line.strip()
    if s.startswith("#"):
        if on:
            break
        parts = s.lstrip("#").strip().split()
        if parts and parts[0] == ver:
            on = True
        continue
    if on:
        out.append(line)
sys.stdout.write("".join(out).strip() + "\n")
