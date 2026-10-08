"""Verify a frozen M0 manifest, then normalize only its CRLF line endings to LF.

Never regenerates expected hashes, modifies payload files, or connects to a server.
Use bytes rather than text writes to avoid Windows newline translation.
"""
from hashlib import sha256
from pathlib import Path
import argparse
import re

DEFAULT_BUNDLE=Path(__file__).resolve().parents[1]/'m0-20260921'

def normalize_manifest(bundle):
    bundle=Path(bundle).resolve()
    manifest=bundle/'SHA256SUMS'
    raw=manifest.read_bytes()
    normalized=raw.replace(b'\r\n',b'\n')
    if b'\r' in normalized or normalized.startswith(b'\xef\xbb\xbf'):
        raise ValueError('Unexpected lone CR or UTF-8 BOM; stop for manual inspection')
    lines=normalized.decode('utf-8').splitlines()
    if not lines:
        raise ValueError('Empty manifest')
    seen=set()
    for line in lines:
        match=re.fullmatch(r'([0-9a-f]{64})  (.+)',line)
        if not match:
            raise ValueError('Invalid checksum record')
        expected,name=match.groups()
        path=(bundle/name).resolve()
        if path==manifest or not path.is_relative_to(bundle) or name in seen:
            raise ValueError('Unsafe/duplicate manifest path')
        seen.add(name)
        if not path.is_file() or sha256(path.read_bytes()).hexdigest()!=expected:
            raise ValueError('Payload missing or changed: '+name+'; expected checksum was NOT regenerated')
    # The existing checksum strings and names remain byte-for-byte unchanged.
    if raw!=normalized:
        manifest.write_bytes(normalized)
    return {'files_verified':len(seen),'changed':raw!=normalized,'crlf_before':raw.count(b'\r\n'),
            'crlf_after':normalized.count(b'\r\n'),'manifest_sha256':sha256(normalized).hexdigest()}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle',type=Path,default=DEFAULT_BUNDLE)
    args=parser.parse_args()
    import json
    print(json.dumps(normalize_manifest(args.bundle),indent=2))
