"""Extracts the changelog section of one version for the GitHub release body.

The section starts at the most specific heading that names the version — a
`## [x.y.z]` entry heading, or the `# vX.Y.Z` marker that bump_version.sh adds
for entries written without one — and ends at the next heading of the same or
higher level, i.e. at the next version. A `###` subsection belongs to the
section it sits in.

Prints nothing when the version has no section, so that the caller's
`[ ! -s release_body.md ]` fallback actually fires (a bare newline would
pass `-s` and publish an empty release body).
"""
import sys

CHANGELOG = "changelog.md"


def heading(line):
    """(level, text) of an ATX heading line, or None if it is not a heading."""
    s = line.lstrip()
    if not s.startswith("#"):
        return None
    level = len(s) - len(s.lstrip("#"))
    return level, s[level:].strip()


def names_version(text, ver):
    """True if a heading's first token is this version, with or without the v."""
    parts = text.split()
    if not parts:
        return False
    token = parts[0].strip("[]()")
    return token in (ver, ver.lstrip("v"))


def section(lines, ver):
    """Lines of the version's section, without its heading."""
    heads = []
    for i, line in enumerate(lines):
        h = heading(line)
        if h is not None and names_version(h[1], ver):
            heads.append((i, h[0], h[1]))
    if not heads:
        return []
    # Deepest match wins: `# v0.0.628` is a release marker, `## [0.0.628]` holds
    # the entry. Ties keep the first occurrence.
    start, level, _ = max(heads, key=lambda h: (h[1], -h[0]))
    end = len(lines)
    for i in range(start + 1, len(lines)):
        h = heading(lines[i])
        if h is not None and h[0] <= level:
            end = i
            break
    return lines[start + 1:end]


ver = sys.argv[1]
body = "".join(section(open(CHANGELOG, encoding="utf-8").readlines(), ver)).strip()
if body:
    sys.stdout.write(body + "\n")
