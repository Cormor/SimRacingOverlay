#!/usr/bin/env python3
"""Build a bounded legacy algorithm hotfix, or official release update metadata."""
import argparse,hashlib,json,re,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ALGORITHMS=('telemetry-context.js','tyre-response.js','steering-advisor.js','reserve.js','grip.js','handling.js','legacy-chassis-response.js','chassis-response.js','suspension-contact.js','realtime-response.js','feedback-research.js','pedal-traction.js','assist.js','g-ball.js')
def version(value):
 if not re.fullmatch(r'\d{1,6}\.\d{1,6}\.\d{1,6}',value):raise argparse.ArgumentTypeError('version must be three numeric components')
 return value
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--version',type=version,default=(ROOT/'VERSION').read_text().strip())
p.add_argument('--base-version',type=version)
p.add_argument('--files',nargs='+',choices=ALGORITHMS)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--setup',type=Path,help='Generate update-manifest.json instead of a hotfix')
p.add_argument('--hotfix',type=Path,help='Include a previously authored hotfix in the release metadata')
p.add_argument('--lixing-output',type=Path,help='Also build the release metadata to be signed locally')
p.add_argument('--release-assets',type=Path,help='Include the complete Windows distribution and bundled wheel packs in the signed manifest')
a=p.parse_args()
if a.lixing_output and not a.setup:p.error('--lixing-output requires --setup')
if a.release_assets and not a.lixing_output:p.error('--release-assets requires --lixing-output')
if a.setup:
 def asset(file):
  return {'name':file.name,'sha256':hashlib.file_digest(file.open('rb'),'sha256').hexdigest()}
 # Keep source history in the same public manifest; deleted or local-only Releases
 # cannot be recovered by enumerating GitHub Release objects.
 history=[]
 changelog=(ROOT/'CHANGELOG.md').read_text(encoding='utf-8')
 sections=re.split(r'^## (\d{1,6}\.\d{1,6}\.\d{1,6})[^\n]*\n',changelog,flags=re.M)
 seen=set()
 for i in range(1,len(sections),2):
  v=sections[i]
  if v in seen:p.error('duplicate changelog version: '+v)
  seen.add(v)
  notes=sections[i+1].strip()
  if not notes:p.error('empty changelog section: '+v)
  if tuple(map(int,v.split('.')))<=tuple(map(int,a.version.split('.'))):history.append({'version':v,'notes':notes})
 history.sort(key=lambda item:tuple(map(int,item['version'].split('.'))))
 if not any(item['version']==a.version for item in history):p.error('target version is missing from CHANGELOG.md')
 data={'schema':1,'version':a.version,'setup':asset(a.setup),'releaseNotes':history}
 if a.hotfix:
  a.output.parent.mkdir(parents=True,exist_ok=True)
  hotfix_target=a.output.parent/a.hotfix.name
  if a.hotfix.resolve()!=hotfix_target.resolve():shutil.copyfile(a.hotfix,hotfix_target)
  a.hotfix=hotfix_target
  pack=json.loads(a.hotfix.read_text(encoding='utf-8'))
  if pack.get('kind')=='simracingoverlay-components':
   assert pack.get('apiVersion')==1
   data['hotfix']={**asset(a.hotfix),'kind':'components','moduleVersion':pack['version']}
  elif pack.get('kind')=='simracingoverlay-hotfix':
   assert pack['version']==a.version
   data.update(baseVersion=pack['baseVersion'],hotfix={**asset(a.hotfix),'kind':'algorithm'})
  else:
   assert pack.get('schemaVersion')==1 and isinstance(pack.get('image'),str)
   data['hotfix']={**asset(a.hotfix),'kind':'wheel'}
else:
 if not a.base_version:p.error('--base-version is required for a hotfix')
 files=a.files or ALGORITHMS
 data={'schema':1,'kind':'simracingoverlay-hotfix','version':a.version,'baseVersion':a.base_version,'files':{name:(ROOT/name).read_text(encoding='utf-8') for name in files}}
 if len(json.dumps(data).encode())>12*1024*1024:p.error('hotfix exceeds 12 MiB')
a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'output':str(a.output),'version':a.version,'kind':data.get('kind','release-manifest')}))

if a.lixing_output:
 artifacts=[{'kind':'setup','file':str(a.setup.resolve())}]
 if a.release_assets:
  catalog=json.loads((ROOT/'assets/wheel-catalog.json').read_text(encoding='utf-8'))
  companions=[('portable',f'SimRacingOverlay-{a.version}-Windows-x64.zip'),('checksums','SHA256SUMS.txt')]
  companions.extend((f'wheel-pack-{index}',face['id']+'.wheel.json') for index,face in enumerate(catalog,1))
  artifacts.extend({'kind':kind,'file':str((a.release_assets/name).resolve())} for kind,name in companions)
  artifacts.append({'kind':'legacy-manifest','file':str(a.output.resolve())})
 if a.hotfix:
  spec=data['hotfix']
  entry={'kind':'hotfix','file':str(a.hotfix.resolve()),'hotfixKind':spec['kind']}
  if spec['kind']=='algorithm':entry['baseVersion']=data['baseVersion']
  if spec['kind']=='components':entry['moduleVersion']=spec['moduleVersion']
  artifacts.append(entry)
 config={'appId':'SimRacingOverlay','repo':'Cormor/SimRacingOverlay','version':a.version,
         'platform':'win32','arch':'x64','channel':'stable','artifacts':artifacts,
         'releaseNotes':data['releaseNotes']}
 with tempfile.TemporaryDirectory() as temporary:
  config_file=Path(temporary)/'release-build-input.json'
  config_file.write_text(json.dumps(config,ensure_ascii=False),encoding='utf-8')
  subprocess.run(['node',str(ROOT/'tools/vendor/update/build-manifest.cjs'),'--config',str(config_file),
                  '--output',str(a.lixing_output)],check=True)
