"""MOZA CS Pro/W17 LED wire decoder. No hardware writes."""
import time,zlib,struct

def frames(data):
    i=0
    while i+5<=len(data):
        if data[i]!=0x7e or not 1<=data[i+1]<=64:i+=1;continue
        size=data[i+1]+5;decoded=list(data[i:i+2]);j=i+2
        while len(decoded)<size and j<len(data):
            b=data[j];decoded.append(b);j+=1
            if b==0x7e and j<len(data) and data[j]==0x7e:j+=1
        if len(decoded)!=size:break
        check=(13+sum(decoded[:-1])+126*decoded[2:-1].count(126))&255
        if check==decoded[-1]:yield bytes(decoded);i=j
        else:i+=1

class LedDecoder:
    def __init__(self):
        self.live={0:[None]*16,1:[None]*8,3:[None]*4}
        self.rendered={0:[None]*16,1:[None]*8,3:[None]*4}
        self.static={0:[None]*16,1:[None]*8,3:[None]*48}
        self.masks={};self.last={};self.mode={};self.source='';self.seen=0
        self.active_knob=[None]*4
        self.mask_frames={};self.frame_meta={}
        self.sessions={};self.sequences={};self.values={};self.telemetry_frames=0
        self.samples={}
        self.dashboard={}
    def feed(self,data,source):
        for f in frames(data):
            if f[2]==0x43:
                self.samples[f[:6].hex()]=f.hex()
                p=f[4:-1]
                if p[:6]==b'\x7d\x23\x32\x00\x23\x32' and len(p)>=8 and p[7]==0x20:
                    data=p[8:]
                    if len(data)==10:
                        x=int.from_bytes(data,'little');v=[]
                        for n in (10,5,16,16,32):v.append(x&((1<<n)-1));x>>=n
                        a=struct.unpack('<f',v[4].to_bytes(4,'little'))[0]
                        if v[0]<=1000 and v[1] in list(range(13))+[31] and v[2]<20000 and v[3]<10000 and -1000<a<1000:
                            self.dashboard.update(rpmPercent=v[0]/10,gear=-1 if v[1]==31 else v[1],rpm=v[2],speedKmh=v[3]/10,angle=a,timestamp=int(time.time()*1000),source=source)
                    elif len(data)==2:self.dashboard['maxRpm']=int.from_bytes(data,'little')
                if p[:2]==b'\x7c\x00' and len(p)>=10 and p[3]==1:
                    sess=p[2];seq=int.from_bytes(p[4:6],'little');body=p[6:-4]
                    if zlib.crc32(body)!=int.from_bytes(p[-4:],'little'):continue
                    key=(source,sess)
                    if self.sequences.get(key)==seq:continue
                    self.sequences[key]=seq
                    buf=self.sessions.get(key,b'')+body
                    while len(buf)>=13:
                        if buf[0]!=255:buf=buf[1:];continue
                        size=int.from_bytes(buf[1:5],'little')
                        if not 4<=size<=10000:buf=buf[1:];continue
                        if len(buf)<9+size:break
                        record=buf[9:9+size]
                        if zlib.crc32(record)!=int.from_bytes(buf[5:9],'little'):buf=buf[1:];continue
                        if size in (8,12):
                            index=int.from_bytes(record[:4],'little')
                            self.values[str(index)]={'u':int.from_bytes(record[4:],'little'),'f':struct.unpack('<f' if size==8 else '<d',record[4:])[0],'t':time.time()}
                            self.telemetry_frames+=1
                        buf=buf[9+size:]
                    self.sessions[key]=buf[-20000:]
                continue
            if f[2:4]!=b'\x3f\x17':continue
            p=f[4:-1];cmd=p[0]
            if len(p)<2:continue
            g=p[1]
            if cmd==0x27 and len(p)>=6 and g<4 and p[2]==0:
                self.active_knob[g]='#'+p[3:6].hex()
            elif g not in self.live:continue
            elif cmd==0x19:
                for i in range(2,len(p)-3,4):
                    n=p[i]
                    if n<len(self.live[g]):self.live[g][n]='#'+p[i+1:i+4].hex()
            elif cmd==0x1a and len(p)>=4:
                self.mask_frames[g]=f.hex()
                self.rendered[g]=list(self.live[g])
                self.frame_meta[g]=dict(t=int(time.time()*1000),rpmPercent=self.dashboard.get('rpmPercent'),telemetryTime=self.dashboard.get('timestamp'))
                self.masks[g]=(int.from_bytes(p[2:6],'little'),int.from_bytes(p[6:10],'little'))
                self.last[g]=time.monotonic()
            elif cmd==0x1f and len(p)>=7:
                n=p[3]
                if n<len(self.static[g]):self.static[g][n]='#'+p[4:7].hex()
            elif cmd==0x1d and len(p)>=3:self.mode[g]=p[2]
            else:continue
            self.source=source;self.seen+=1
    def colors(self,g):
        if time.monotonic()-self.last.get(g,0)<1:
            active,window=self.masks[g]
            return [c if (active>>i)&1 else '#000000' for i,c in enumerate(self.rendered[g])]
        if self.mode.get(g)==1:return self.static[g]
        if self.mode.get(g)==0:return ['#000000']*len(self.live[g])
        # Internal animated effects have no host frame; do not invent their phase.
        return [None]*len(self.live[g])
    def snapshot(self):
        c={g:self.colors(g) for g in self.live}
        return dict(available=any(x is not None for a in c.values() for x in a),
                    buttons=c[1],rpm=c[0],knobs=c[3][:4],source=self.source,
                    frameMeta=self.frame_meta,maskFrames=self.mask_frames,masks=self.masks,frames=self.seen,timestamp=int(time.time()*1000),
                    telemetryValues=self.values,telemetryFrames=self.telemetry_frames,
                    protocolSamples=self.samples,
                    dashboard=self.dashboard,
                    knobBackgrounds=self.static[3],knobForegrounds=self.active_knob,idleModes=self.mode,
                    note='host-command observation; internal animations may be unavailable')
