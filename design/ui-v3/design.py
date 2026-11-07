"""UI-D3正式页面设计源。先读docs/UI-COMPONENTS.md；不连接应用或用户数据。"""
from pathlib import Path
from html import escape
import base64
import ctypes as C
from ctypes.util import find_library
import json

ROOT = Path(__file__).resolve().parent
APP = ROOT.parents[1]
TOKENS = json.loads((ROOT/'tokens.json').read_text())
WHEEL = 'data:image/png;base64,'+base64.b64encode((APP/'assets/wheel.png').read_bytes()).decode()


def png(source, destination, width, height):
    r, c, g = [C.CDLL(find_library(n)) for n in ['rsvg-2','cairo','gobject-2.0']]
    ptr = C.c_void_p
    def fn(lib, name, args, result):
        f=getattr(lib,name); f.argtypes=args; f.restype=result; return f
    class Rect(C.Structure):
        _fields_=[(n,C.c_double) for n in ['x','y','width','height']]
    load=fn(r,'rsvg_handle_new_from_file',[C.c_char_p,ptr],ptr)
    surface=fn(c,'cairo_image_surface_create',[C.c_int,C.c_int,C.c_int],ptr)(0,width,height)
    context=fn(c,'cairo_create',[ptr],ptr)(surface)
    handle=load(str(source).encode(),None)
    try:
        ok=fn(r,'rsvg_handle_render_document',[ptr,ptr,C.POINTER(Rect),ptr],C.c_int)(handle,context,C.byref(Rect(0,0,width,height)),None)
        if not ok: raise RuntimeError('设计图渲染失败：'+str(source))
        if fn(c,'cairo_surface_write_to_png',[ptr,C.c_char_p],C.c_int)(surface,str(destination).encode()): raise RuntimeError('设计图保存失败')
    finally:
        fn(c,'cairo_destroy',[ptr],None)(context)
        fn(c,'cairo_surface_destroy',[ptr],None)(surface)
        fn(g,'g_object_unref',[ptr],None)(handle)


class Page:
    def __init__(self, ident, title, light=False, width=1440, height=960):
        self.id,self.title,self.w,self.h=ident,title,width,height
        self.t=TOKENS['color']['light' if light else 'dark']
        self.a=[f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}" height="{height}" viewBox="0 0 {width} {height}">', '<style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif}</style><defs><filter id="glow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="5"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>']
        self.a.append('<defs><linearGradient id="goldMetal" x1="4%" y1="-25%" x2="96%" y2="125%"><stop offset="0" stop-color="#B98A2A"/><stop offset=".18" stop-color="#E8C66A"/><stop offset=".35" stop-color="#FFF0AE"/><stop offset=".47" stop-color="#C49A3E"/><stop offset=".52" stop-color="#FFED9B"/><stop offset=".72" stop-color="#E8C66A"/><stop offset="1" stop-color="#B98A2A"/></linearGradient><linearGradient id="goldSheen" x1="4%" y1="-25%" x2="96%" y2="125%"><stop offset=".43" stop-color="white" stop-opacity="0"/><stop offset=".49" stop-color="white" stop-opacity=".28"/><stop offset=".55" stop-color="white" stop-opacity="0"/></linearGradient><pattern id="grain" width="3" height="3" patternUnits="userSpaceOnUse"><path d="M0 .5 H3" stroke="white" stroke-opacity=".055"/></pattern></defs>')
        self.rect(0,0,width,height,'canvas',radius=0)
        self.rect(0,0,width,56,'surface',radius=0)
        self.text(24,35,'SRO',20,'accent',True); self.text(80,35,'SimRacingOverlay',18,bold=True)
        self.text(width/2,35,title,14,'textMuted',anchor='middle')
        self.caption()
        self.text(20,height-12,f'{ident} · UI-D3 · {width}×{height} CSS px · 2026-11-03',12,'textMuted')
        self.text(width-20,height-12,'正式设计 / 公开示例 / 非运行截图',12,'textMuted',anchor='end')

    def color(self,c): return self.t.get(c,c)
    def rect(self,x,y,w,h,fill='surface',stroke=None,radius=8,sw=1):
        self.a.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{self.color(fill)}"'+(f' stroke="{self.color(stroke)}" stroke-width="{sw}"' if stroke else '')+'/>')
    def text(self,x,y,s,size=16,color='text',bold=False,anchor='start'):
        self.a.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{self.color(color)}" font-weight="{600 if bold else 400}" text-anchor="{anchor}">{escape(str(s))}</text>')
    def path(self,d,color='text',sw=1.5): self.a.append(f'<path d="{d}" fill="none" stroke="{self.color(color)}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>')
    def icon(self,name,x,y,color='text',size=20):
        paths={'chevron-right':'M7 4 L13 10 L7 16','chevron-down':'M4 7 L10 13 L16 7','chevron-left':'M13 4 L7 10 L13 16','min':'M2.5 10 H17.5','max':'M2.5 2.5 H17.5 V17.5 H2.5 Z','restore':'M6 2.5 H17.5 V14 M2.5 6 H14 V17.5 H2.5 Z','close':'M2.5 2.5 L17.5 17.5 M17.5 2.5 L2.5 17.5','eye':'M2 10 Q10 0 18 10 Q10 20 2 10 Z M8 10 A2 2 0 1 0 12 10 A2 2 0 1 0 8 10','lock':'M6 8 V5 Q10 0 14 5 V8 M4 8 H16 V18 H4 Z','unlock':'M6 8 V5 Q10 0 14 5 M4 8 H16 V18 H4 Z','undo':'M8 4 L3 9 L8 14 M3 9 H12 Q18 9 17 16','grid':'M3 3 H17 V17 H3 Z M3 10 H17 M10 3 V17','focus':'M3 7 V3 H7 M13 3 H17 V7 M17 13 V17 H13 M7 17 H3 V13','check':'M4 10 L8 14 L16 5'}
        self.a.append(f'<g transform="translate({x} {y}) scale({size/20})">'); self.path(paths.get(name,paths['grid']),color); self.a.append('</g>')
    def caption(self,state=None):
        for i,n in enumerate(['min','max','close']):
            x=self.w-144+i*48
            if state==n:self.rect(x,6,48,44,'danger' if n=='close' else 'surfaceRaised',radius=0)
            self.icon(n,x+16,20,'onDanger' if state==n=='close' else 'text',16)
    def button(self,x,y,w,s,primary=False,disabled=False):
        fill=('accentFill' if 'accentFill' in self.t else 'accent') if primary else 'surfaceRaised'
        self.rect(x,y,w,44,fill,'border' if not primary else None)
        self.text(x+w/2,y+28,s,16,'onAccentFill' if primary and 'onAccentFill' in self.t else 'onAccent' if primary else 'textMuted' if disabled else 'text',anchor='middle')
    def metal(self,x,y,w,h,radius=8):
        self.rect(x,y,w,h,'url(#goldMetal)','accent',radius)
        self.rect(x,y,w,h,'url(#grain)',radius=radius)
        self.rect(x,y,w,h,'url(#goldSheen)',radius=radius)
    def field(self,x,y,w,label,value,disabled=False):
        self.text(x,y,label,14,'textMuted'); self.rect(x,y+12,w,44,'surfaceRaised','border',6)
        self.text(x+12,y+41,value,16,'textMuted' if disabled else 'text')
    def disclosure(self,x,y,w,label,open=False,count=None):
        self.rect(x,y,w,44,'surfaceRaised',radius=6); self.icon('chevron-down' if open else 'chevron-right',x+14,y+14,size=16)
        self.text(x+44,y+28,label,14,bold=True)
        if count is not None:self.text(x+w-12,y+28,count,12,'textMuted',anchor='end')
    def nav(self,current):
        self.rect(0,56,200,self.h-88,'surface',radius=0)
        for i,n in enumerate(['概览','布局编辑','盘面与输入','连接与显示']):
            y=88+i*56
            if n==current:self.rect(12,y,176,44,'surfaceRaised','accent',6)
            self.icon(['grid','focus','eye','grid'][i],24,y+12,'accent' if n==current else 'textMuted')
            self.text(56,y+28,n,16,'accent' if n==current else 'text')
        self.text(24,self.h-120,'● 后台运行',14,'success')
        self.text(24,self.h-84,'Ctrl+Alt+M 编辑',12,'textMuted')
    def card(self,x,y,w,h,title,caption=''):
        self.rect(x,y,w,h,'surface',radius=12); self.text(x+24,y+37,title,18,bold=True)
        if caption:self.text(x+24,y+67,caption,14,'textMuted')
    def glow(self,x,y,w,h,color):
        self.a.append('<g filter="url(#glow)" opacity=".65">'); self.rect(x,y,w,h,'none',color,5,2); self.a.append('</g>'); self.rect(x,y,w,h,'none',color,5,1.5)

    def core(self,x,y,scale=1,ghost=False):
        self.a.append(f'<g transform="translate({x} {y}) scale({scale})" opacity="{.25 if ghost else 1}">')
        if not ghost:
            self.rect(152,0,216,54,'#111923','#ffc75a',8)
            self.text(260,23,'黄旗挥动',20,'#ffc75a',True,'middle'); self.text(260,44,'准备停车',16,'#edf5ff',anchor='middle')
        for xx in [10,330]:
            for yy,col,p in [(76,'#ffc34e',.45),(104,'#66f0c3',.72)]:
                self.rect(xx,yy,180,18,'#1c2938','#73879d',4)
                if not ghost:self.rect(xx+2,yy+2,176*p,14,col,radius=3); self.glow(xx,yy,180,18,col)
        if not ghost:self.text(260,105,'推头',22,'#ffc75a',True,'middle')
        self.path('M120 145 H400','#73879d'); self.rect(250,137,30,16,'#83d7f2',radius=3)
        self.a.append(f'<image x="100" y="165" width="320" height="320" xlink:href="{WHEEL}"/>')
        self.rect(204,247,112,44,'#111923','#73879d',4)
        if not ghost:self.text(260,272,'3   140',22,'#edf5ff',True,'middle');self.text(260,287,'7390 RPM',10,'#a4b7cc',anchor='middle')
        for xx,col,label in [(20,'#ff5673','刹车'),(476,'#65e3ad','油门')]:
            self.rect(xx,190,24,250,'#1c2938','#73879d',5)
            if not ghost:
                self.rect(xx+3,320,18,117,col,radius=3); self.glow(xx,190,24,250,col)
                self.text(xx+12,177,label,16,'#edf5ff',anchor='middle');self.text(xx+12,467,'48%',16,'#edf5ff',anchor='middle')
        for xx in [76,444]:
            for yy,v in [(235,'−26%'),(402,'+20%')]:
                self.path(f'M{xx} {yy-30} V{yy+30}','#73879d')
                if not ghost:self.rect(xx-7,yy-8,14,24,'#8fafff',radius=4);self.text(xx+14,yy+5,v,14,'#8fafff')
        self.a.append('<circle cx="260" cy="343" r="36" fill="#111923" fill-opacity=".8" stroke="#73879d"/>')
        if not ghost:
            self.path('M240 348 L249 328 L272 337 L260 354 Z','#8bd3bc'); self.text(260,366,'0.97g',16,'#edf5ff',anchor='middle')
            self.rect(226,397,68,44,'#111923','#ffc75a',5);self.text(260,425,'手刹',16,'#ffc75a',anchor='middle')
            self.text(260,469,'实际减速 0.98g',18,'#edf5ff',anchor='middle')
        self.path('M120 498 H400','#73879d');self.rect(251,490,30,16,'#f6bd84',radius=3)
        if not ghost:
            for i,s in enumerate(['ABS','TC','ESC']):
                self.rect(142+i*80,522,72,32,'#111923','#ffc75a',5);self.glow(142+i*80,522,72,32,'#ffc75a');self.text(178+i*80,544,s,16,'#ffc75a',True,'middle')
        self.a.append('</g>')

    def stage(self,x,y,w,h,ghost=False):
        self.rect(x,y,w,h,'canvas','border',6)
        fit=min(w/2560,h/1440); sw,sh=2560*fit,1440*fit; sx=x+(w-sw)/2;sy=y+(h-sh)/2
        for gx in range(int(x+16),int(x+w),32):self.path(f'M{gx} {y} V{y+h}','#263039',.5)
        for gy in range(int(y+16),int(y+h),32):self.path(f'M{x} {gy} H{x+w}','#263039',.5)
        self.rect(sx,sy,sw,sh,'none','border',0)
        s=sh*.42662290502793293/554; hx=sx+sw/2-260*s; hy=sy+sh*.98-554*s
        self.core(hx,hy,s,ghost);return hx,hy,s
    def save(self):
        out=ROOT/(self.id+'.svg');out.write_text(''.join(self.a)+'</svg>',encoding='utf-8');png(out,ROOT/(self.id+'.png'),self.w,self.h)
        print(self.id+' · '+self.title,flush=True)


MODULES=[('方向盘与仪表',['方向盘','独立仪表']),('踏板与输入',['刹车与辅助','油门与辅助','手刹']),('车辆与轮胎',['左前轮滑移','右前轮滑移','左后轮滑移','右后轮滑移','左侧裕度','右侧裕度','前轴侧滑','后轴侧滑','姿态状态','实际减速']),('状态与G力',['ABS / TC / ESC','G力球','iRacing旗语'])]


def editor(ident='P02',multi=False,collapsed=False,error=False,light=False,compact=False,scroll=False,defer=False):
    p=Page(ident,'布局编辑',light,width=960 if compact else 1440,height=720 if compact else 960)
    compact=compact or collapsed
    nav=64 if compact else 200; left=44 if compact else 248; right=44 if compact else 320
    if not compact:p.nav('布局编辑')
    else:
        p.rect(0,56,64,p.h-88,'surface',radius=0)
        for i in range(4):p.icon('focus' if i==1 else 'grid',22,96+56*i,'accent' if i==1 else 'textMuted')
    p.rect(nav,56,p.w-nav,64,'surface',radius=0);p.text(nav+24,96,'中下方驾驶布局',20,bold=True)
    p.button(p.w-376,66,96,'撤销');p.button(p.w-268,66,96,'重做');p.button(p.w-160,66,136,'更多操作')
    start=nav+left; end=p.w-right
    if compact:
        for x,name in [(nav,'chevron-right'),(p.w-44,'chevron-left')]:
            p.rect(x,120,44,p.h-216,'surface',radius=0);p.rect(x,p.h/2-44,44,88,'surfaceRaised','border',6);p.icon(name,x+14,p.h/2-8,size=16)
    else:
        p.rect(nav,120,left,p.h-216,'surface',radius=0);p.text(nav+16,152,'模块',18,bold=True)
        p.icon('chevron-left',nav+left-34,135)
        p.a.append(f'<defs><clipPath id="moduleClip"><rect x="{nav}" y="174" width="{left}" height="{p.h-270}"/></clipPath></defs><g clip-path="url(#moduleClip)">')
        y=174-(392 if scroll else 0)
        for group,items in MODULES:
            p.disclosure(nav+8,y,left-16,group,True,str(len(items)));y+=44
            for item in items:
                selected=item in (['方向盘','刹车与辅助','油门与辅助'] if multi else ['方向盘'])
                if selected:p.rect(nav+8,y,left-16,44,'surfaceRaised','accent',6)
                p.text(nav+16,y+28,item,16,'accent' if selected else 'text');p.icon('eye',nav+left-80,y+12,size=18);p.icon('lock' if multi and item=='油门与辅助' else 'unlock',nav+left-38,y+12,size=18)
                y+=44
        p.a.append('</g>')
        # 下方模块在同一列表中延续滚动，不另建内部滚动区。
        p.rect(nav+left-8,180,8,p.h-300,'surfaceRaised',radius=4)
        p.rect(nav+left-8,480 if scroll else 180,8,260,'border',radius=4)
    p.text(start+24,153,'显示器1 · 2560×1440 · 适应',14,'textMuted')
    p.text(end-24,153,'保存失败' if error else '已保存',14,'danger' if error else 'success',anchor='end')
    if error:
        p.rect(start+16,170,end-start-32,76,'surface','danger',8);p.text(start+32,200,'保存失败：文件暂时无法写入',16,'danger',True);p.text(start+32,228,'修改仍保留；重试成功后再完成或关闭。',14,'textMuted')
    top=262 if error else 174
    hx,hy,s=p.stage(start+16,top,end-start-32,p.h-top-164)
    bx=20 if multi else 100;bw=400 if multi else 320
    p.rect(hx+bx*s,hy+165*s,bw*s,320*s,'none','accent',0,2)
    p.rect(hx+(bx+bw)*s-4,hy+485*s-4,8,8,'accent',radius=1)
    p.text(start+24,p.h-116,'现场：  ● 虚影    ○ 正常预览    ○ 隐藏',14,'accent')
    if not compact:
        x=p.w-320;p.rect(x,120,320,p.h-216,'surface',radius=0);p.text(x+20,152,'已选3项 · 1项锁定' if multi else '方向盘',18,bold=True);p.icon('chevron-right',p.w-36,135)
        p.text(x+20,183,'2项可变换 · 以共同中心操作' if multi else '原款盘面 · 位置可编辑',14,'textMuted')
        ps=1440*.42662290502793293/554;position=f'{round(1280-(260-bx)*ps)} / {round(1440*.98-389*ps)} px'
        for i,(n,v) in enumerate([('位置 X / Y',position),('等比缩放','100 %'),('整体透明度','混合' if multi else '100 %')]):p.field(x+20,220+i*88,280,n,v)
        p.disclosure(x+16,490,288,'高级属性',multi or light)
        if multi or light:
            p.field(x+20,568,132,'宽度','多选禁用' if multi else '355 px',multi);p.field(x+164,568,132,'高度','多选禁用' if multi else '355 px',multi)
            p.field(x+20,652,132,'旋转增量' if multi else '绝对角度','0°');p.field(x+164,652,132,'层级','混合' if multi else '0')
            p.button(x+20,734,132,'左对齐');p.button(x+164,734,132,'上移一层')
            p.text(x+20,812,'更多属性向下滚动',14,'textMuted')
        else:
            p.disclosure(x+16,548,288,'盘面与仪表方式');p.disclosure(x+16,606,288,'对齐与层级');p.disclosure(x+16,664,288,'分项复位')
            p.button(x+20,736,280,'找回屏外模块')
    p.rect(nav,p.h-96,p.w-nav,64,'surface',radius=0);p.text(nav+24,p.h-57,'选择 / 拖动 · Shift多选 · Esc取消',14,'textMuted')
    if error:p.button(p.w-312,p.h-86,136,'重试保存',True)
    p.button(p.w-160,p.h-86,136,'完成编辑',not error)
    if light:p.rect(p.w-306,226,292,56,'none','focus',8,3)
    if not defer:p.save()
    return p


def overview():
    p=Page('P01','概览');p.nav('概览');p.text(232,106,'准备好你的驾驶画面',28,bold=True);p.text(232,141,'分别查看连接与显示，按需进入编辑。',16,'textMuted')
    for x,w,t,v in [(232,356,'游戏遥测','示例：iRacing SDK'),(604,356,'设备输入','示例：方向盘与踏板'),(976,432,'桌面显示','显示器1 · 鼠标穿透')]:
        p.card(x,174,w,160,t,v);p.text(x+24,301,'● 可用' if x<976 else '显示中',18,'success',True)
    p.card(232,358,728,530,'当前布局','中下方驾驶布局 · 全部核心指示保留');p.stage(256,454,680,346);p.text(256,856,'预览消费现有绘制结果；不初始化第二套模型。',14,'textMuted')
    p.card(984,358,424,530,'继续调整');p.button(1008,444,376,'编辑布局',True);p.button(1008,504,376,'盘面与输入');p.button(1008,564,376,'连接与显示');p.text(1008,676,'OBS源与桌面显隐独立',16);p.text(1008,712,'未取得OBS场景变换，不声称最终落点。',14,'textMuted');p.text(1008,828,'关闭管理窗后继续后台运行',14,'textMuted');p.save()


def wheels():
    p=Page('P05','盘面与输入');p.nav('盘面与输入');p.text(232,106,'盘面与输入',28,bold=True);p.button(232,130,120,'盘面',True);p.button(364,130,140,'设备输入')
    p.card(232,198,688,690,'原款盘面','当前使用 · 内置 · 离线可用');p.a.append(f'<image x="362" y="306" width="420" height="420" xlink:href="{WHEEL}"/>');p.button(256,786,312,'此盘面的按键映射');p.text(256,858,'厂设编号与用户覆盖分别保留',14,'textMuted')
    p.card(944,198,464,690,'盘面选择与仪表');p.field(968,286,416,'当前盘面','原款盘面');p.icon('chevron-down',1356,311)
    p.rect(968,350,416,148,'surfaceRaised','border',8);p.text(992,386,'✓ 原款盘面 · 当前',16,'accent');p.text(992,430,'GT Pro 圆盘 · 可下载',16);p.text(992,474,'下载完成后可选择，旧盘保持',14,'textMuted')
    p.text(968,538,'下载失败：连接暂不可用',16,'danger');p.button(968,558,180,'重试下载');p.field(968,650,416,'仪表方式','跟随盘面（auto）');p.icon('chevron-down',1356,675);p.field(968,728,416,'仪表页面','页面1 · 挡位保持朝上');p.icon('chevron-down',1356,753);p.disclosure(968,802,416,'此盘面的按键映射',False,'16+');p.text(968,874,'独立仪表不随盘面转动',14,'textMuted');p.save()


def devices():
    p=Page('P06','盘面与输入 · 设备输入');p.nav('盘面与输入');p.text(232,106,'设备输入',28,bold=True);p.button(232,130,120,'盘面');p.button(364,130,140,'设备输入',True)
    p.card(232,198,736,228,'方向盘','当前绑定：轴X；总转向角900°');p.field(256,296,360,'总转向角','900 °');p.button(768,290,176,'重新学习')
    p.card(232,450,736,438,'刹车 · 正在学习','原绑定保留到你采用新结果；取消不会清空旧绑定。');p.text(256,566,'先松开，再踩满；本次观察范围',16);p.rect(256,599,688,4,'border',radius=2);p.rect(256,599,560,4,'success',radius=2);p.a.append('<circle cx="816" cy="601" r="10" fill="#72D6A4"/>');p.text(256,666,'本次：独立踏板 / 轴Y',16);p.text(256,702,'旧绑定：独立踏板 / 轴Z',14,'textMuted');p.button(256,790,212,'采用并保存',True);p.button(484,790,180,'取消学习')
    p.card(992,198,416,690,'其他输入');p.field(1016,298,368,'油门','自动 / 游戏输入');p.button(1016,378,368,'学习设备轴');p.field(1016,506,368,'手刹','自动 / 游戏输入');p.button(1016,586,368,'学习设备轴');p.disclosure(1016,694,368,'旧通用按键位置');p.text(1016,830,'不自动迁移到每盘面映射',14,'textMuted');p.save()


def connections():
    p=Page('P07','连接与显示');p.nav('连接与显示');p.text(232,106,'连接与显示',28,bold=True)
    p.card(232,142,552,746,'当前连接','只显示现有接口能判定的状态');
    for i,(t,v) in enumerate([('游戏来源','iRacing SDK · 示例'),('输入设备','方向盘 / 踏板 · 示例'),('逐轮原生能力','未提供的字段保持未知'),('辅助介入','实际触发与设置档位分开')]):p.text(256,262+i*136,t,16,bold=True);p.text(256,298+i*136,v,14,'textMuted')
    p.card(808,142,600,746,'显示与OBS');p.field(832,244,552,'目标显示器','显示器1 · 2560×1440 · 100%');p.icon('chevron-down',1356,269)
    p.rect(832,308,552,296,'surfaceRaised','border',8)
    p.rect(846,396,520,44,'none','focus',6,3)
    for i,t in enumerate(['✓ 显示器1 · 2560×1440 · 当前','显示器2 · 宽屏显示器长名称…','显示器3 · 1920×1080 · 125%','显示器4 · 3840×2160 · 150%','显示器5 · 竖屏 · 1080×1920','显示器6 · 扩展显示器…']):p.text(856,342+i*44,t,16,'accent' if i==0 else 'text')
    p.rect(1370,322,8,260,'border',radius=2);p.rect(1370,322,8,148,'textMuted',radius=2);p.text(832,648,'Enter选择 / Esc取消 · 更多项向下滚动',14,'textMuted');p.button(832,682,264,'显示桌面叠加',True);p.button(1112,682,272,'隐藏桌面叠加');p.text(832,788,'OBS浏览器源仍使用正常画面',16);p.text(832,826,'不接收虚影、选框或管理器装饰',14,'textMuted');p.save()


def controls():
    p=Page('P09','控件状态与几何附图');p.text(32,106,'窗口控制、展开与收起的完整定义',26,bold=True)
    p.text(32,144,'C01–04：标题栏56；每个按钮48×44；图形16；no-drag；焦点3px',16,'textMuted')
    for i,(label,state) in enumerate([('默认',None),('悬停关闭','close'),('按下','max'),('键盘焦点','min')]):
        x=32+i*344;p.rect(x,178,320,124,'surface','border',8);p.text(x+16,210,label,16)
        for j,n in enumerate(['min','max','close']):
            bx=x+16+j*48;p.rect(bx,234,48,44,'danger' if state==n=='close' else '#383B3E' if state==n and i==2 else 'surfaceRaised',radius=0);p.icon(n,bx+16,248,'onDanger' if state==n=='close' else 'text',16)
        if i==3:p.rect(x+13,231,54,50,'none','focus',3,3)
    p.text(32,354,'C08 分组展开：44高整行；16图形；同一控件控制同一组',18,bold=True);p.disclosure(32,382,600,'高级属性',False);p.disclosure(664,382,600,'高级属性',True)
    p.text(32,478,'C09 整栏收起：44宽侧条；44×88热区；方向与目标栏一致',18,bold=True)
    for i,(label,icon) in enumerate([('左栏展开','chevron-right'),('左栏收起','chevron-left'),('右栏展开','chevron-left'),('右栏收起','chevron-right')]):
        x=32+i*344;p.text(x,516,label,16);p.rect(x,538,44,88,'surfaceRaised','border',6);p.icon(icon,x+14,574,size=16)
    p.text(32,682,'C11 Slider：44高热区 / 4轨道 / 20拇指',18,bold=True);p.rect(32,712,600,44,'surface','border',6);p.rect(48,732,568,4,'border',radius=2);p.rect(48,732,300,4,'accent',radius=2);p.a.append('<circle cx="348" cy="734" r="10" fill="#E8C66A"/>')
    p.field(680,692,584,'C14 选择框：44高；选项44；6行后滚动','当前项');p.icon('chevron-down',1228,716)
    p.text(32,832,'所有按钮、图标、边界、状态和样式引用UI-COMPONENTS中的C/S定义；此图仅为页面图补充。',16,'textMuted');p.save()


def ghost():
    p=Page('P12','现场虚影 · 编辑器在另一处操作');p.rect(24,80,1392,816,'#25323b',radius=8)
    p.a.append('<path d="M24 470 H1416 V896 H24Z" fill="#3b4145"/><path d="M590 470 H850 L1300 896 H140Z" fill="#525a5f"/>')
    p.text(48,120,'合成背景，仅用于设计示意；应用不采集屏幕',16,'#edf5ff');p.text(48,156,'同一布局 · 无手柄 · 不抢焦点 · 全程鼠标穿透',16,'#a4b7cc')
    # 同一舞台参数；无数字、事件文案，不重排其余模块。
    fit=min(1392/2560,816/1440); sh=1440*fit;s=sh*.42662290502793293/554
    p.core(720-260*s,80+(816-sh)/2+sh*.98-554*s,s,True)
    p.card(48,670,396,176,'现场显示：虚影','淡化只作用于当前编辑会话');p.text(72,784,'正常预览恢复完整辉光；结束恢复原显隐。',14,'textMuted');p.save()


def core_sheet():
    p=Page('P13','核心指示完整对照',width=1440,height=1120);p.core(120,136,1.36)
    p.card(904,96,504,936,'18模块与关键子状态','示例组合不证明任何游戏具备全部字段')
    lines=['方向盘 / 原材质 / 转角 / 按钮 / 旋钮 / 灯','仪表：嵌入、独立、隐藏均保留','刹车与油门真实输入＋辅助边缘辉光','四轮有符号滑移 / 锁死 / 卸载离地','左右四条裕度：每侧上前、下后','前后轴侧滑 / 估计侧偏角及单位','姿态：推头 / 甩尾 / 侧摆（分状态）','实际减速g / 手刹实际输入与百分比','ABS / TC / ESC实际介入','G力当前 / 轨迹 / 峰值包络 / 清峰','iRacing旗语名称 / 中文解释 / 原优先级']
    for i,t in enumerate(lines):p.text(928,218+i*64,t,16)
    p.text(928,946,'全部继续使用已有数据与算法。',16,'accent',True);p.rect(928,974,452,64,'#111923','#73879d',6);p.text(1154,1014,'独立仪表  3 / 140km/h / 7390rpm',18,'#edf5ff',anchor='middle');p.save()


def commands(tail=False):
    p=editor('P22' if tail else 'P15',defer=True)
    p.rect(1096,116,320,282,'surfaceRaised','border',12)
    labels=['全选  Ctrl+A','移动整体','导入布局…','导出布局','复位所选','整体复位'] if not tail else ['导入布局…','导出布局','复位所选','整体复位','清空G峰值','网格吸附  ✓']
    for i,t in enumerate(labels):
        if i==0:p.rect(1104,124,304,44,'surface','focus',8)
        p.text(1120,152+i*44,t,16)
    p.rect(1400,130,8,256,'surface',radius=4);p.rect(1400,240 if tail else 130,8,120,'border',radius=4)
    p.save()


def advanced():
    p=editor('P16',defer=True);x=1120;p.rect(x,120,320,744,'surface',radius=0)
    p.text(x+20,152,'方向盘 · 属性滚动延续',18,bold=True);p.disclosure(x+16,174,288,'透明度',True)
    for i,(label,value) in enumerate([('整体',80),('文字',100),('图形',85)]):
        y=238+i*66;p.text(x+20,y,label,14,'textMuted');p.text(x+292,y,str(value)+'%',16,anchor='end');p.rect(x+20,y+24,268,4,'border',radius=2);p.rect(x+20,y+24,268*value/100,4,'accent',radius=2);p.a.append(f'<circle cx="{x+20+268*value/100}" cy="{y+26}" r="10" fill="{p.color("accent")}"/>')
    p.button(x+20,430,280,'复位透明度');p.disclosure(x+16,490,288,'对齐与层级',True)
    for i,t in enumerate(['左对齐','顶对齐','横向居中','下移一层','上移一层','置底','置顶']):
        p.button(x+20+(i%2)*144,546+(i//2)*50,136,t)
    p.disclosure(x+16,758,288,'分项复位',True);p.text(x+20,834,'仅位置 / 尺寸 / 方向 / 宽 / 高',14,'textMuted');p.rect(1432,174,8,670,'surfaceRaised',radius=4);p.rect(1432,470,8,280,'border',radius=4);p.save()


def mapping():
    p=Page('P17','盘面与输入 · 按键映射');p.nav('盘面与输入');p.text(232,106,'GT Pro 圆盘 · 按键映射',26,bold=True)
    p.text(232,144,'按盘保存覆盖值；厂设来源与编号保留。当前为表格向下滚动后的内容。',16,'textMuted')
    p.card(232,174,1176,652,'映射表 · 展开','留空清除该控件映射；录入后按实体键，取消不更改旧值。')
    face=json.loads((APP/'wheel-packs/simagic-gt-pro-round/profile.json').read_text())
    rows=face['controls'][8:]+face['encoders']
    for i,c in enumerate(rows):
        y=274+i*64;p.text(256,y+28,c['label'],16);p.rect(600,y,348,44,'surfaceRaised','border',6);p.text(612,y+28,','.join(map(str,c['b'])),16);p.button(968,y,108,'录入');p.button(1092,y,108,'清空')
    p.rect(1396,260,8,548,'surfaceRaised',radius=4);p.rect(1396,460,8,260,'border',radius=4)
    p.button(232,846,260,'恢复此盘默认映射');p.button(508,846,200,'取消当前录入');p.text(744,876,'布局自动保存 · 不覆盖其他盘面',16,'textMuted');p.save()


def device_tail():
    p=Page('P18','设备设置 · 延续');p.nav('盘面与输入');p.text(232,106,'设备输入 · 更多设置',26,bold=True)
    p.card(232,142,672,324,'手刹与第二手刹','第二手刹保留第一手刹依赖；不改变原轴判断。')
    for i,t in enumerate(['手刹','第二手刹']):
        y=240+i*100;p.text(256,y+28,t,16);p.button(432,y,200,'开始学习');p.button(648,y,232,'恢复自动')
    p.card(928,142,480,324,'旧通用按键位置','仍写settings.json，不迁移到按盘映射。');p.field(952,252,432,'显示位置（18项）','位置 1');p.icon('chevron-down',1348,277);p.button(952,340,216,'学习按键');p.button(1184,340,200,'取消录入')
    p.card(232,490,1176,306,'灯色观察与设置保存')
    p.rect(256,568,20,20,'surfaceRaised','accent',4);p.icon('check',256,568,'accent');p.text(292,586,'MOZA 灯色观察（可选，只读）',18)
    p.text(256,638,'读取已运行的软件输出，不控制硬件；关联启动时应用。',16,'textMuted')
    p.text(256,690,'设备设置保存：inputs / steeringRange / buttonMap / ledObserver',16,'textMuted');p.text(256,730,'方向、油门、刹车也各自保留“恢复自动”；这里不修改算法。',14,'textMuted')
    p.button(1136,834,272,'保存设备设置',True);p.save()


def drawer():
    p=editor('P19',compact=True,defer=True);x=p.w-320;p.rect(x,120,320,p.h-216,'surface','border',0)
    p.text(x+20,154,'方向盘 · 属性',18,bold=True);p.rect(p.w-60,128,44,44,'surfaceRaised','border',8);p.icon('close',p.w-46,142,size=16)
    p.field(x+20,210,280,'位置 X / Y','1103 / 980 px');p.field(x+20,302,280,'等比缩放','100 %');p.field(x+20,394,280,'整体透明度','100 %');p.disclosure(x+16,490,288,'高级属性');p.text(x+20,574,'Esc收起；焦点回到右侧展开条。',14,'textMuted');p.rect(x+14,216,292,56,'none','focus',8,3);p.save()


def indication_states():
    p=Page('P20','核心指示子状态');p.text(32,106,'沿用原指示含义：独立公开示例',26,bold=True);p.text(32,144,'这些状态分别成立；不拼成一段真实工况，不新增计算或阈值。',16,'textMuted')
    p.card(32,182,656,284,'前后轴侧滑 / 估计角度')
    for y,label,value,color in [(286,'F 前轴','+3.2°','#83d7f2'),(390,'R 后轴','−1.6°','#f6bd84')]:
        p.text(56,y,label,18,color);p.path(f'M200 {y-6} H500','#73879d',2);p.rect(340,y-14,48,16,color,radius=4);p.text(540,y,value,20,color)
    p.card(712,182,696,284,'手刹与有效零')
    p.rect(736,264,188,104,'#111923','#ffc75a',10);p.text(830,300,'手刹',20,'#ffc75a',True,'middle');p.text(830,342,'48%',28,'#edf5ff',True,'middle')
    p.text(976,296,'有效值 0%',20,'success');p.rect(976,326,392,20,'surfaceRaised','border',5);p.text(976,402,'零有数据；空轨道不等同未知。',16,'textMuted')
    p.card(32,490,1376,398,'四轮原指示子状态')
    states=[('锁死','−100%','#ff365d'),('卸载 / 离地','空框','#edf5ff'),('缺失 / 过期','—','#a4b7cc'),('有效零','0%','#65e3ad')]
    for i,(label,v,col) in enumerate(states):
        x=64+i*336;p.text(x,582,label,20,col,True);p.rect(x+100,622,26,136,'#111923',col,6,3)
        if i==0:p.glow(x+100,622,26,136,col);p.rect(x+104,660,18,94,col,radius=3)
        p.text(x+112,804,v,22,col,anchor='middle')
    p.save()


def material_study():
    p=Page('P21','黑金 / 白金 · 静态金属材质');p.text(32,106,'让金色有清晰的光，而不是整片泛黄',28,bold=True);p.text(32,144,'固定方向的明暗、高光与细纹；同一套共享材质，不运行实时光照或闪烁。',16,'textMuted')
    for i,theme in enumerate(['dark','light']):
        p.t=TOKENS['color'][theme];x=32+i*704;p.rect(x,182,672,666,'canvas','border',12);p.text(x+24,230,'黑金' if i==0 else '白金',24,bold=True)
        p.text(x+24,282,'原平面金色',14,'textMuted');p.rect(x+24,306,272,64,'#E8C66A','border',8)
        p.text(x+24,422,'共享静态金属材质',16,bold=True);p.metal(x+24,446,624,136,12)
        p.text(x+336,524,'澄澈高光 · 暖金属暗部',24,'#17140D',True,'middle')
        p.button(x+24,634,272,'完成并保存',True);p.button(x+312,634,336,'普通操作保持干净')
        p.text(x+24,742,'正文与状态色保持原语义。',16,'text');p.text(x+24,782,'118°静态方向 / 窄高光 / 0.055细纹',14,'textMuted')
    p.t=TOKENS['color']['dark'];p.save()


def reset_page():
    p=editor('P23',defer=True);x=1120;p.rect(x,120,320,744,'surface',radius=0);p.text(x+20,154,'方向盘 · 属性延续',18,bold=True);p.disclosure(x+16,190,288,'分项复位',True)
    for i,t in enumerate(['仅位置','仅尺寸','仅方向','仅宽度','仅高度','复位所选']):p.button(x+20+(i%2)*144,250+(i//2)*56,136,t)
    p.text(x+20,462,'上述修改均可撤销。',14,'textMuted');p.text(x+20,498,'锁定项不参与所选复位。',14,'textMuted');p.disclosure(x+16,552,288,'透明度');p.disclosure(x+16,610,288,'对齐与层级');p.rect(1432,174,8,670,'surfaceRaised',radius=4);p.rect(1432,570,8,260,'border',radius=4);p.save()


if __name__=='__main__':
    overview();editor();editor('P03',multi=True);editor('P04',collapsed=True);wheels();devices();connections();editor('P08',error=True);controls();editor('P10',light=True);editor('P11',compact=True);ghost();core_sheet();editor('P14',scroll=True);commands();advanced();mapping();device_tail();drawer();indication_states();commands(True);reset_page()
    names={'P01':'概览','P02':'单选编辑','P03':'多选与高级属性','P04':'双栏收起','P05':'盘面选择与下载失败','P06':'设备学习','P07':'连接与长列表','P08':'保存失败','P09':'控件状态与几何','P10':'浅色与焦点','P11':'紧凑窗口','P12':'现场虚影','P13':'核心指示完整对照','P14':'完整模块列表滚动延续','P15':'更多操作展开','P16':'高级属性滚动延续','P17':'盘面映射长表','P18':'设备设置延续','P19':'紧凑属性抽屉','P20':'核心指示子状态','P21':'黑金白金静态金属材质','P22':'命令菜单滚动延续'}
    names.pop('P21');names['P23']='分项复位完整展开'
    body=''.join(f'<figure id="{k}"><figcaption>{k} · {v}</figcaption><img src="{k}.png" alt="{v}"><a href="{k}.svg">可编辑SVG</a></figure>' for k,v in names.items())
    links=''.join(f'<a href="#{k}">{k}</a>' for k in names)
    links+='<a href="#M3c">M3c · 金属应用1.1</a>'
    body+='<figure id="M3c"><figcaption>M3c · 已批准材质应用1.1（取代P21）</figcaption><img src="../material-v2/m3c-application.png" alt="144/240/376深浅金属应用"><a href="../material-v2/M3C-APPLICATION.md">先行应用定义</a></figure>'
    (ROOT/'index.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RacingOverlay UI-D3 正式设计</title><style>body{background:#101112;color:#f4f1e8;font:16px/1.6 system-ui;margin:24px}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#e8c66a}figure{margin:32px 0}img{width:100%;max-width:1440px;display:block;border:1px solid #555149}figcaption{font-size:20px;margin:12px 0}</style><h1>RacingOverlay UI-D3 正式设计</h1><p>先定义，再页面设计，再实现。图中使用公开示例；非实际截图或运行验收。</p><nav>'+links+'</nav><p><a href="../../docs/UI-COMPONENTS.md">控件与样式定义</a> · <a href="../../docs/UI-DESIGN.md">设计及程序员契约</a></p>'+body+'</html>',encoding='utf-8')
