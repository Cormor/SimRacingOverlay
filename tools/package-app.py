#!/usr/bin/env python3
"""Stage the Windows application without development material or user state."""
import argparse,json,shutil
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--output',type=Path,required=True)
p.add_argument('--native',type=Path,required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[1];out=a.output
out.mkdir(parents=True,exist_ok=False)
def copy(source,relative):
 target=out/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
for pattern in ('*.js','*.css','*.html','*.lua','*.ps1','*.cmd','VERSION','LICENSE'):
 for source in root.glob(pattern):
  if source.name not in ('Install.ps1','Install.cmd','Uninstall.ps1'):copy(source,source.name)
for directory in ('src','defaults','licenses','assets'):
 for source in (root/directory).rglob('*'):
  if not source.is_file():continue
  rel=source.relative_to(root)
  if '__pycache__' in rel.parts or source.suffix=='.pyc' or rel.as_posix()=='assets/layout.json' or 'wheel-packs' in rel.parts or 'modules' in rel.parts or 'components' in rel.parts:continue
  if source.name.startswith(('test_','test-')):continue
  copy(source,rel)
for name in ('Lifecycle.ps1','Discovery.ps1','Register-Obs.ps1','Register-SimHub.ps1','Install-App.ps1','Uninstall-App.ps1','package-components.cjs','package-hotfix.py'):
 source=root/'tools'/name
 if source.exists():copy(source,Path('tools')/name)
for name in ('SimRacingBridge.exe','SimRacingLauncher.exe','OverlayLifecycle.dll','native-build.json'):
 copy(a.native/name,Path('runtime')/name)
for name in ('SimRacingOverlay.SimHub.dll','MozaLedObserver.exe','SharpDX.dll','SharpDX.DirectInput.dll'):
 copy(root/'runtime'/name,Path('runtime')/name)
shutil.copytree(root/'runtime/electron',out/'runtime/electron')
for name in ('INSTALL.md','UPDATES.md','COMPONENT-PLUGINS.md','COMPONENT-EXPERIENCE.md','COMPONENT-ACCESSIBILITY.md'):
 if (root/'docs'/name).exists():copy(root/'docs'/name,Path('docs')/name)
# A ready-to-import current baseline is shipped as an editable compatibility example.
algorithm_names=('telemetry-context.js','tyre-response.js','steering-advisor.js','reserve.js','grip.js','handling.js','legacy-chassis-response.js','chassis-response.js','suspension-contact.js','realtime-response.js','feedback-research.js','pedal-traction.js','assist.js','g-ball.js')
example={'schema':1,'kind':'simracingoverlay-hotfix','baseVersion':(root/'VERSION').read_text().strip(),'version':(root/'VERSION').read_text().strip(),'files':{name:(root/name).read_text(encoding='utf-8') for name in algorithm_names}}
(out/'examples').mkdir(exist_ok=True)
(out/'examples/algorithm-baseline.hotfix.json').write_text(json.dumps(example,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for relative in ('examples/pedal-motion.component.json','examples/component-package/manifest.json','examples/component-package/plugin.js'):
 source=root/relative
 if source.exists():copy(source,Path(relative))
(out/'application.json').write_text(json.dumps({'application':'SimRacingOverlay','version':(root/'VERSION').read_text().strip(),'entry':'runtime/SimRacingLauncher.exe'},indent=2)+'\n')
print(out)
