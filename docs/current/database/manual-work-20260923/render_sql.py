"""Validate this bundle and expand one reviewed psql entrypoint to stdout.

No database, credentials or subprocess access. Render fully before output so a
validation failure cannot send a partial migration into a DBA-owned psql pipe.
"""
import argparse
import hashlib
from pathlib import Path
import sys

ENTRIES = ("000_inspect.sql", "apply.sql", "verify.sql", "003_bind_project.sql")


def render_entry(entry, directory=None):
    root = (directory or Path(__file__).resolve().parent).resolve()
    if entry not in ENTRIES:
        raise ValueError("Only reviewed entrypoints may be rendered")
    checked = {}
    for line in (root / "SHA256SUMS").read_text(encoding="ascii").splitlines():
        expected, name = line.split(maxsplit=1)
        path = (root / name).resolve()
        if path.parent != root or name in checked:
            raise ValueError("Invalid or duplicate manifest path")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("Bundle checksum mismatch: " + name)
        checked[name] = data

    def expand(name, stack):
        if name in stack or name not in checked or not name.endswith(".sql"):
            raise ValueError("Invalid, unverified or cyclic SQL include")
        lines = []
        for line in checked[name].decode("utf8").splitlines():
            if line.startswith("\\ir "):
                lines.append(expand(line[4:].strip(), (*stack, name)))
            else:
                lines.append(line)
        return "\n".join(lines) + "\n"

    return expand(entry, ())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entry", choices=ENTRIES)
    args = parser.parse_args()
    try:
        rendered = render_entry(args.entry)
    except (OSError, ValueError) as exc:
        print("Refusing to render: " + str(exc), file=sys.stderr)
        return 1
    sys.stdout.buffer.write(rendered.encode("utf8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
