#!/usr/bin/env python3
"""Create a clean portable distribution from an explicit source/runtime allowlist."""
from pathlib import Path
import hashlib,json,shutil,zipfile,re
ROOT=Path(__file__).resolve().parents[1]
version=(ROOT/'VERSION').read_text().strip()
DIST=ROOT/'dist';DIST.mkdir(exist_ok=True)
stage=DIST/f'SimRacingOverlay-{version}-Windows-x64'
if stage.exists(): raise SystemExit('Stage exists; choose a new version or archive the previous stage before packaging.')
stage.mkdir()
source=[]
for glob in ('*.js','*.html','*.lua','*.ps1','*.cmd','*.md','VERSION','LICENSE','.gitignore','.gitattributes'):
 source.extend(p for p in ROOT.glob(glob) if p.is_file())
for folder in ('src','assets','defaults','tools','tests','docs','licenses'):
 source.extend(p for p in (ROOT/folder).rglob('*') if p.is_file() and p.name!='layout.json' or p.is_file() and folder=='defaults')
# assets/layout.json is user state, defaults/layout.json is a public empty layout.
source=sorted(set(p for p in source if '__pycache__' not in p.parts and p.suffix!='.pyc'))
patterns=[re.compile(bytes.fromhex('31 32 39 38 34')),re.compile(bytes.fromhex('77 78 69 64 5f'),re.I),re.compile(bytes.fromhex('6d 6f 7a 61 5f 6f 62 73 5f 6f 76 65 72 6c 61 79'),re.I),re.compile(rb'[A-Z]:[\\/]Users[\\/]',re.I)]
def inspect_file(p):
 data=p.read_bytes()
 for pattern in patterns:
  if pattern.search(data) or pattern.search(data.replace(b'\x00',b'')):raise RuntimeError('Privacy scan failed: '+str(p.relative_to(ROOT)))
for p in source:
 inspect_file(p);rel=p.relative_to(ROOT)
 for target in (stage/rel,stage/'source'/rel):target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
for name in ('SimRacingBridge.exe','SimRacingLauncher.exe','SimRacingOverlay.SimHub.dll','MozaLedObserver.exe','SharpDX.dll','SharpDX.DirectInput.dll'):
 p=ROOT/'runtime'/name
 inspect_file(p);target=stage/'runtime'/name;target.parent.mkdir(exist_ok=True);shutil.copyfile(p,target)
shutil.copytree(ROOT/'runtime/electron',stage/'runtime/electron')
manifest=[]
for p in sorted(stage.rglob('*')):
 if p.is_file():manifest.append({'path':p.relative_to(stage).as_posix(),'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()})
(stage/'PAYLOAD.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
archive=DIST/(stage.name+'.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(stage.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(stage.parent))
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
sha=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()
(DIST/'SHA256SUMS.txt').write_text(sha+'  '+archive.name+'\n',encoding='ascii')
print(json.dumps({'archive':archive.name,'bytes':archive.stat().st_size,'sha256':sha,'payloadFiles':len(manifest)}))
