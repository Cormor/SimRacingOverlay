"""固定两份输入的原生SVG配色对照；PNG只是设计预览，无测试/色值扫描。"""
from pathlib import Path
from html import escape
import ctypes as C
from ctypes.util import find_library
import json

ROOT=Path(__file__).resolve().parent
TOKENS=[('canvas','canvas'),('surface','surface'),('surfaceRaised','surface-raised'),('text','text'),
        ('textMuted','text-muted'),('border','border'),('accent','accent'),('onAccent','on-accent'),
        ('accentFill','accent-fill'),('onAccentFill','on-accent-fill'),('focus','focus')]


def build(before,after):
    nodes=['<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="804" viewBox="0 0 1120 804">',
           '<title>白金浅色：相同上下文语义色对照</title>',
           '<desc>纯SVG rect/path/text，无位图。两侧同几何、文案、状态与固定金边轮廓；只比较11个语义色，物理Au与2.3缓存没有重渲染。</desc>',
           '<style>text{font-family:Inter,"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif}</style>',
           '<rect width="1120" height="804" fill="#17191B"/>']
    def text(x,y,value,size=14,color='#1F2937',weight=400,anchor='start'):
        nodes.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{color}">{escape(value)}</text>')
    def rect(x,y,w,h,fill,r=8,stroke=None,sw=1,extra=''):
        edge='' if stroke is None else f' stroke="{stroke}" stroke-width="{sw}"'
        nodes.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{edge} {extra}/>')
    def button(x,y,w,label,c,kind,identity):
        h=44;b=1.5;body=c['surface'];fg=c['text'];border=c['border']
        if kind=='primary':body=c['accentFill'];fg=c['onAccentFill'];border='#B69142';b=2
        if kind=='hover':body=c['surfaceRaised'];border='#B69142';b=2
        if kind=='selected':border=c['accent']
        rect(x,y,w,h,body)
        if kind=='selected':
            nodes.append(f'<defs><clipPath id="{identity}"><rect x="{x+b}" y="{y+b}" width="{w-2*b}" height="{h-2*b}" rx="{8-b}"/></clipPath></defs>')
            rect(x,y+h-b-3,w,3,c['accent'],r=0,extra=f'clip-path="url(#{identity})"')
        rect(x+b/2,y+b/2,w-b,h-b,'none',8-b/2,border,b)
        if kind=='focus':rect(x-4.5,y-4.5,w+9,h+9,'none',12.5,c['focus'],3)
        text(x+w/2,y+h/2+5,label,16,fg,600,'middle')
    text(24,44,'白金浅色 · 色彩对照',26,'#F4F1E8',600)
    text(24,77,'相同上下文的语义色与控件',16,'#B7B0A3')
    for x,c,title,key in [(24,before,'原浅色','before'),(572,after,'清亮白金','after')]:
        rect(x,100,524,680,c['canvas'],16)
        text(x+20,136,title,22,c['text'],600)
        text(x+20,160,'布局设置',14,c['textMuted'])
        rect(x+20,184,484,200,c['surface'],12,c['border'])
        text(x+36,216,'布局与显示',20,c['text'],600)
        text(x+468,216,'默认布局',14,c['accent'],500,'end')
        text(x+36,241,'选择显示器，调整组件位置',14,c['textMuted'])
        button(x+36,264,88,'采用',c,'primary',key+'-primary')
        button(x+140,264,144,'取消',c,'default',key+'-default')
        button(x+300,264,144,'悬停',c,'hover',key+'-hover')
        button(x+36,332,144,'键盘焦点',c,'focus',key+'-focus')
        button(x+210,332,144,'已选中',c,'selected',key+'-selected')
        text(x+376,349,'✓ 正常',14,c['success'],500)
        text(x+376,374,'已连接',14,c['info'])
        rect(x+20,404,484,48,c['surfaceRaised'],8)
        text(x+36,434,'组件随窗口布局调整',14,c['textMuted'])
        text(x+468,434,'编辑布局',14,c['accent'],500,'end')
        text(x+20,482,'语义色',16,c['text'],600)
        for index,(name,label) in enumerate(TOKENS):
            col=index%2;row=index//2;sx=x+20+col*252;sy=500+row*34
            rect(sx,sy,34,24,c[name],4,c['border'],.7)
            text(sx+44,sy+10,'--'+label,12,c['text'],500)
            text(sx+44,sy+26,c[name],12,c['textMuted'])
        text(x+20,741,'固定金边仅为同几何配色示意；物理缓存沿用2.3',12,c['textMuted'])
        text(x+20,763,'44px / R8 · 状态与语义色分工保持',12,c['textMuted'])
    nodes.append('</svg>');return '\n'.join(nodes)+'\n'


def png(source,destination):
    r,c,g=[C.CDLL(find_library(name)) for name in ['rsvg-2','cairo','gobject-2.0']];ptr=C.c_void_p
    def fn(lib,name,args,result):
        f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
    class Rect(C.Structure):_fields_=[(name,C.c_double) for name in ['x','y','width','height']]
    surface=fn(c,'cairo_image_surface_create',[C.c_int,C.c_int,C.c_int],ptr)(0,1120,804)
    context=fn(c,'cairo_create',[ptr],ptr)(surface)
    handle=fn(r,'rsvg_handle_new_from_file',[C.c_char_p,ptr],ptr)(str(source).encode(),None)
    try:
        ok=fn(r,'rsvg_handle_render_document',[ptr,ptr,C.POINTER(Rect),ptr],C.c_int)(handle,context,C.byref(Rect(0,0,1120,804)),None)
        if not ok:raise RuntimeError('SVG设计预览导出失败')
        result=fn(c,'cairo_surface_write_to_png',[ptr,C.c_char_p],C.c_int)(surface,str(destination).encode())
        if result:raise RuntimeError('PNG设计预览保存失败')
    finally:
        fn(c,'cairo_destroy',[ptr],None)(context);fn(c,'cairo_surface_destroy',[ptr],None)(surface);fn(g,'g_object_unref',[ptr],None)(handle)


def main():
    before=json.loads((ROOT/'before.json').read_text())['color']['light']
    after=json.loads((ROOT/'after.json').read_text())['color']['light']
    source=ROOT/'palette-comparison.svg';source.write_text(build(before,after))
    png(source,ROOT/'palette-comparison.png')
    print('已保存同上下文纯SVG对比与PNG设计预览：'+str(source),flush=True)


if __name__=='__main__':main()
