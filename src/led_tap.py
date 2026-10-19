"""Read-only observer for the serial writes already made by Pit House or AZOM.

Attaches to the controller process; it never opens COM ports or changes output.
The observed host commands are not a physical LED acknowledgement.
"""
import sys,os,time,json,pathlib,threading
ROOT=(pathlib.Path(sys.executable).resolve().parent.parent if getattr(sys,'frozen',False) else pathlib.Path(__file__).resolve().parent.parent)
sys.path.insert(0,str(ROOT/'runtime/pythonlibs'))
import frida
from led_decoder import LedDecoder
decoder=LedDecoder()
sessions={}
lock=threading.Lock()
last_error=''
counts={}

def message(source,message,data):
    global last_error
    if message.get('type')=='error':
        last_error=message.get('description','hook error');return
    payload=message.get('payload',{})
    if payload.get('kind')=='counts':counts[source]=payload['counts']
    if payload.get('kind')=='led' and data:
        with lock: decoder.feed(bytes(data),source)

def main():
    if "--self-test" in sys.argv:
        (ROOT/"runtime/observer-selftest.json").write_text(json.dumps({"frida":frida.__version__,"decoder":bool(decoder),"script":(ROOT/"src/led-tap.js").is_file()}),encoding="utf-8")
        return
    global last_error
    dev=frida.get_local_device()
    source=(ROOT/'src/led-tap.js').read_text(encoding='utf-8')
    while True:
        try:
            processes=dev.enumerate_processes()
            wanted={p.pid:p.name for p in processes if p.name.lower() in ('moza pit house.exe','simhubwpf.exe','racinglab.exe')}
            for pid in list(sessions):
                if pid not in wanted:
                    try:sessions.pop(pid).detach()
                    except Exception:pass
            for pid,name in wanted.items():
                if pid in sessions:continue
                try:
                    session=dev.attach(pid);script=session.create_script(source)
                    script.on('message',lambda m,d,n=name:message(n,m,d));script.load()
                    sessions[pid]=session
                    print('LED observer attached:',name,pid,flush=True)
                except Exception as e:last_error=str(e)
            with lock:
                result=decoder.snapshot();result['attached']=list(wanted.values());result['error']=last_error;result['counts']=counts
            tmp=ROOT/'runtime/led-state.tmp'
            tmp.write_text(json.dumps(result),encoding='utf-8');os.replace(tmp,ROOT/'runtime/led-state.json')
            last_error=''
        except Exception as e:last_error=str(e)
        time.sleep(.1)

if __name__=='__main__':main()
