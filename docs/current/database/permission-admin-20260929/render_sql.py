"""Validate and expand one reviewed permission-admin psql entrypoint.

The renderer has no database, credential, network or subprocess access. It verifies
SHA256SUMS before recursively expanding only the checked-in relative SQL includes.
"""
import argparse
import hashlib
from pathlib import Path
import sys

ENTRIES = ("inspect.sql", "apply.sql", "verify.sql", "rollback.sql")


def _checked_files(root: Path) -> dict[str, bytes]:
    checked: dict[str, bytes] = {}
    for line in (root / "SHA256SUMS").read_text(encoding="ascii").splitlines():
        expected, name = line.split(maxsplit=1)
        path = (root / name).resolve()
        if path.parent != root or name in checked:
            raise ValueError("Invalid or duplicate manifest path")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("Bundle checksum mismatch: " + name)
        checked[name] = data
    return checked


def render_entry(entry: str, directory: Path | None = None) -> str:
    root = (directory or Path(__file__).resolve().parent).resolve()
    if entry not in ENTRIES:
        raise ValueError("Only reviewed entrypoints may be rendered")
    checked = _checked_files(root)

    def expand(name: str, stack: tuple[str, ...]) -> str:
        if name in stack or name not in checked or not name.endswith(".sql"):
            raise ValueError("Invalid, unverified or cyclic SQL include")
        lines: list[str] = []
        for line in checked[name].decode("utf-8").splitlines():
            if line.startswith("\\ir "):
                lines.append(expand(line[4:].strip(), (*stack, name)))
            else:
                lines.append(line)
        return "\n".join(lines) + "\n"

    return expand(entry, ())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entry", choices=ENTRIES)
    args = parser.parse_args()
    try:
        rendered = render_entry(args.entry)
    except (OSError, ValueError) as exc:
        print("Refusing to render: " + str(exc), file=sys.stderr)
        return 1
    sys.stdout.buffer.write(rendered.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
