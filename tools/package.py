#!/usr/bin/env python3
"""Create a clean portable distribution from an explicit source/runtime allowlist."""
from pathlib import Path
import hashlib,json,shutil,zipfile
from privacy_scan import inspect_file
ROOT=Path(__file__).resolve().parents[1]
version=(ROOT/'VERSION').read_text().strip()
DIST=ROOT/'dist';DIST.mkdir(exist_ok=True)
stage=DIST/f'SimRacingOverlay-{version}-Windows-x64'
if stage.exists(): raise SystemExit('Stage exists; choose a new version or archive the previous stage before packaging.')
stage.mkdir()
source=[]
for glob in ('*.js','*.css','*.html','*.lua','*.ps1','*.cmd','*.md','VERSION','LICENSE','.gitignore','.gitattributes'):
 source.extend(p for p in ROOT.glob(glob) if p.is_file())
for folder in ('src','assets','defaults','tools','tests','docs','licenses'):
 source.extend(p for p in (ROOT/folder).rglob('*') if p.is_file() and p.name!='layout.json' or p.is_file() and folder=='defaults')
# Machine-specific runtime state is excluded; the shared preset is public.
source=sorted(set(p for p in source if '__pycache__' not in p.parts and p.suffix!='.pyc'))
# Rebuilt native files must be bound to the exact source in this package.
receipt=json.loads((ROOT/'runtime/native-build.json').read_text(encoding='utf-8-sig'))
for group in ('sources','binaries'):
 for name,expected in receipt[group].items():
  if hashlib.file_digest((ROOT/name).open('rb'),'sha256').hexdigest()!=expected:raise RuntimeError('Native build/source mismatch: '+name)
for p in source:
 inspect_file(p);rel=p.relative_to(ROOT)
 for target in (stage/rel,stage/'source'/rel):target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
for name in ('SimRacingBridge.exe','SimRacingLauncher.exe','SimRacingOverlay.SimHub.dll','MozaLedObserver.exe','SharpDX.dll','SharpDX.DirectInput.dll','native-build.json'):
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
