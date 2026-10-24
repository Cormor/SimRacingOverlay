#!/usr/bin/env python3
"""Reuse a verified release runtime only while its native/observer sources are unchanged."""
from pathlib import Path, PurePosixPath
import hashlib, sys, zipfile
root=Path(__file__).resolve().parents[1]
archive=Path(sys.argv[1]); expected=sys.argv[2]
rebuild='--rebuild-native' in sys.argv[3:]
compiled={'Bridge.cs','PhysicsTelemetry.cs','IRacingTelemetry.cs','TelemetryEventStream.cs','SimHubTelemetry.cs','NativeMotionTelemetry.cs','NativeUdpTelemetry.cs','TelemetrySourceSelection.cs','Launcher.cs'}
reused={'SimHubPlugin.cs','led_tap.py','led_decoder.py'}
if hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()!=expected:
    raise SystemExit('Base release SHA256 mismatch')
with zipfile.ZipFile(archive) as z:
    prefix=z.namelist()[0].split('/')[0]+'/'
    for p in (root/'src').rglob('*'):
        if p.is_file() and p.name in (reused if rebuild else reused|compiled):
            name=prefix+'source/'+p.relative_to(root).as_posix()
            # Git checkout applies .gitattributes CRLF to C#; only normalize line endings.
            if name not in z.namelist() or z.read(name).replace(b'\r\n',b'\n')!=p.read_bytes().replace(b'\r\n',b'\n'):
                raise SystemExit('Runtime source changed; rebuild required: '+p.relative_to(root).as_posix())
    allowed={'SimRacingBridge.exe','SimRacingLauncher.exe','SimRacingOverlay.SimHub.dll','MozaLedObserver.exe','SharpDX.dll','SharpDX.DirectInput.dll'}
    count=0
    for info in z.infolist():
        if info.is_dir() or not info.filename.startswith(prefix+'runtime/'): continue
        rel=PurePosixPath(info.filename[len(prefix):])
        if '..' in rel.parts or rel.is_absolute(): raise SystemExit('Invalid runtime path')
        if rel.parts[1]!='electron' and rel.name not in allowed: continue
        if rebuild and rel.name in {'SimRacingBridge.exe','SimRacingLauncher.exe'}:continue
        target=root/str(rel); target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(z.read(info));count+=1
print('Restored verified, source-matched runtime files:',count)
