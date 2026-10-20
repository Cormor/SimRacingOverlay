#!/usr/bin/env python3
"""Upload a verified package to an existing draft by ID, without tag lookup."""
from pathlib import Path
import hashlib,json,os,urllib.request
root=Path(__file__).resolve().parents[1]
repo=os.environ['GITHUB_REPOSITORY'];release_id=int(os.environ['RELEASE_ID'])
api='https://api.github.com/repos/'+repo
headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','User-Agent':'SimRacingOverlay-release'}
def call(url,method='GET',data=None,kind='application/json'):
    req=urllib.request.Request(url,method=method,data=data,headers={**headers,'Content-Type':kind})
    with urllib.request.urlopen(req,timeout=240) as response:
        body=response.read()
        return json.loads(body) if body else None
release=call(api+'/releases/'+str(release_id));version=(root/'VERSION').read_text().strip()
assert release['draft'] and release['tag_name']=='v'+version,'Target must be the matching draft release'
for name in ['SimRacingOverlay-'+version+'-Windows-x64.zip','SHA256SUMS.txt']:
    data=(root/'dist'/name).read_bytes();digest='sha256:'+hashlib.sha256(data).hexdigest()
    for old in release['assets']:
        if old['name']==name:call(api+'/releases/assets/'+str(old['id']),'DELETE')
    asset=call(release['upload_url'].split('{')[0]+'?name='+name,'POST',data,'application/zip' if name.endswith('.zip') else 'text/plain')
    assert asset['state']=='uploaded' and asset['size']==len(data) and asset['digest']==digest
    print('Uploaded and verified:',name,digest,flush=True)
