"""Reject credentials and identifying account material, not shareable preferences."""
from pathlib import Path
import re,zipfile,io
RULES={
 'github-credential':re.compile(rb'(?:gh[pousr]_[A-Za-z0-9_]{24,}|github_pat_[A-Za-z0-9_]{40,})'),
 'private-key':re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'known-account-path':re.compile(rb'(?:[A-Z]:[\\/]+Users[\\/]+(?!Public[\\/]|Default[\\/])[^\\/\x00\r\n"<>:]+[\\/]|/(?:mnt/[a-z]/[Uu]sers|home)/[^/\x00\r\n"<>]+/)',re.I),
 'messaging-account':re.compile(rb'wxid_[a-z0-9]{5,}',re.I),
 'literal-secret':re.compile(rb'''(?:api[_-]?key|password|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_+/=-]{32,}["']''',re.I),
}
def inspect_bytes(data,name,depth=0):
 for rule,pattern in RULES.items():
  if pattern.search(data) or pattern.search(data.replace(b'\x00',b'')):raise RuntimeError(f'Sensitive material: {name} ({rule})')
 if depth<2 and data.startswith(b'PK\x03\x04'):
  with zipfile.ZipFile(io.BytesIO(data)) as archive:
   for item in archive.infolist():
    if not item.is_dir():inspect_bytes(archive.read(item),name+'!'+item.filename,depth+1)
def inspect_file(path):
 path=Path(path)
 if path.name.lower() in {'.env','.credentials.yaml','credentials.json','credentials.txt'}:raise RuntimeError('Credential file: '+path.name)
 inspect_bytes(path.read_bytes(),path.name)
