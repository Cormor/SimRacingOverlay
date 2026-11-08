#!/usr/bin/env python3
"""Verify the preserved historical algorithm archive, not current source identity."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "docs/ALGORITHM-BASELINE.json").read_text(encoding="utf-8"))
archive = root / manifest["archive"]
if hashlib.sha256(archive.read_bytes()).hexdigest() != manifest["archiveSha256"]:
    raise SystemExit("Historical algorithm archive SHA256 differs")
with zipfile.ZipFile(archive) as source:
    for name, expected in manifest["files"].items():
        data = source.read("source/" + name)
        actual = hashlib.sha256(data).hexdigest()
        normalized = hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()
        if actual != expected and normalized != manifest.get("normalizedFiles", {}).get(name):
            raise SystemExit("Historical algorithm archive source differs: " + name)
print("PASS: " + manifest["marker"] + " historical archive and archived source match")
