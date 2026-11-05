"""M2a离线设计资源生成器；不接触运行程序、已有图或用户数据。"""
from pathlib import Path
from functools import lru_cache
import base64
import ctypes as C
from ctypes.util import find_library
import json
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'assets'
PARAMS = {'seed': 20261103, 'samples': 64, 'f0_linear_rgb': [.91, .68, .31],
          'roughness': {'polished': .18, 'fine_matte': .34}, 'roughness_jitter': .004,
          'button': {'width': 240, 'height': 44, 'radius': 8, 'bevel_width': 2.2,
                     'bevel_height': .9, 'crown_height': .37},
          'tile': {'width': 480, 'height': 240, 'radius': 18, 'bevel_width': 3.5,
                   'bevel_height': 1.2, 'crown_height': 2.0},
          'environment': {'background': [.09, .19],
                          'key_box': [-.24, -.22, .30, .23, .035], 'key_intensity': 2.35,
                          'side_box': [1.30, -.08, .12, 1.0, .12], 'side_intensity': 1.5,
                          'fill_box': [-1.15, .38, .30, .70, .24], 'fill_intensity': .38,
                          'negative_box': [.58, .48, .34, .30, .20], 'negative_intensity': .17},
          'environment_yaw_degrees': [-12, 0, 12], 'normal_quantization': 2048,
          'roughness_quantization': 1024, 'tone_mapping': 'Reinhard then sRGB'}


def write_png(path, w, h, rgba):
    def chunk(kind, body):
        return struct.pack('!I', len(body)) + kind + body + struct.pack('!I', zlib.crc32(kind + body))
    rows = b''.join(b'\x00' + rgba[y*w*4:(y+1)*w*4] for y in range(h))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', w, h, 8, 6, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b''))


def smooth(t):
    t = min(1., max(0., t))
    return t*t*(3-2*t)


def box(u, v, cx, cy, hx, hy, softness):
    return (1-smooth((abs(u-cx)-hx)/softness))*(1-smooth((abs(v-cy)-hy)/softness))


def environment(x, y, z, yaw):
    s, c = math.sin(yaw), math.cos(yaw)
    x, z = c*x+s*z, -s*x+c*z
    env=PARAMS['environment']
    base = env['background'][0] + env['background'][1]*max(0., z)
    if z <= .015:
        return base
    u, v = x/z, y/z
    key = env['key_intensity']*box(u,v,*env['key_box'])
    side = env['side_intensity']*box(u,v,*env['side_box'])
    fill = env['fill_intensity']*box(u,v,*env['fill_box'])
    negative = env['negative_intensity']*box(u,v,*env['negative_box'])
    return max(.035, base+key+side+fill-negative)


def radical_inverse(i):
    result, f = 0., .5
    while i:
        result += f*(i & 1)
        f *= .5
        i >>= 1
    return result


SAMPLES = [((i+.5)/PARAMS['samples'], (radical_inverse(i)+.317)%1)
           for i in range(PARAMS['samples'])]


def normalize(x, y, z):
    k = 1/math.sqrt(x*x+y*y+z*z)
    return x*k, y*k, z*k


def g1(cosine, alpha):
    return 2*cosine/(cosine+math.sqrt(alpha*alpha+(1-alpha*alpha)*cosine*cosine))


@lru_cache(maxsize=200000)
def reflection(qx, qy, qz, qr, yaw_degrees):
    nx, ny, nz = normalize(qx,qy,qz)
    roughness = qr/PARAMS['roughness_quantization']
    alpha = roughness*roughness
    tx, ty, tz = normalize(nz,0,-nx)
    bx, by, bz = ny*tz-nz*ty, nz*tx-nx*tz, nx*ty-ny*tx
    a, b = 0., 0.
    gv = g1(max(nz,1e-5),alpha)
    yaw = math.radians(yaw_degrees)
    for u, v in SAMPLES:
        hz = math.sqrt((1-u)/(1+(alpha*alpha-1)*u))
        radius = math.sqrt(max(0.,1-hz*hz))
        phi = 2*math.pi*v
        hx, hy = radius*math.cos(phi), radius*math.sin(phi)
        wx, wy, wz = tx*hx+bx*hy+nx*hz, ty*hx+by*hy+ny*hz, tz*hx+bz*hy+nz*hz
        nl = 2*wz*hz-nz
        if wz <= 0 or nl <= 0:
            continue
        illumination = environment(2*wz*wx,2*wz*wy,2*wz*wz-1,yaw)
        weight = illumination*gv*g1(nl,alpha)*wz/max(1e-7,nz*hz)
        a += weight
        b += weight*(1-wz)**5
    n = len(SAMPLES)
    result=[]
    for f0 in PARAMS['f0_linear_rgb']:
        linear = max(0.,(f0*a+(1-f0)*b)/n)
        mapped = linear/(1+linear)
        srgb = 12.92*mapped if mapped <= .0031308 else 1.055*mapped**(1/2.4)-.055
        result.append(min(255,max(0,round(srgb*255))))
    return tuple(result)


def noise(x, y):
    k = (x*374761393+y*668265263+PARAMS['seed']) & 0xffffffff
    k = ((k ^ (k >> 13))*1274126177) & 0xffffffff
    return ((k ^ (k >> 16)) & 0xffff)/65535


def generate(name, geometry, roughness, yaw=0, plane=False):
    w,h,r = geometry['width'],geometry['height'],geometry['radius']
    pixels=bytearray(w*h*4)
    for iy in range(h):
        for ix in range(w):
            x,y = ix+.5-w/2,iy+.5-h/2
            px,py = abs(x)-w/2+r,abs(y)-h/2+r
            ox,oy=max(px,0.),max(py,0.)
            distance=math.hypot(ox,oy)+min(max(px,py),0.)-r
            coverage=min(1.,max(0.,.5-distance))
            if not coverage:
                continue
            if ox and oy:
                length=math.hypot(ox,oy)
                gx,gy=math.copysign(ox/length,x),math.copysign(oy/length,y)
            elif px>py:
                gx,gy=math.copysign(1.,x),0.
            else:
                gx,gy=0.,math.copysign(1.,y)
            slope=0.
            if not plane:
                t=max(0.,min(.999,1-max(0.,-distance)/geometry['bevel_width']))
                slope=geometry['bevel_height']*t/(geometry['bevel_width']*math.sqrt(max(1e-6,1-t*t)))
            crown=0. if plane else geometry['crown_height']
            nx,ny,nz=normalize(gx*slope+2*crown*x/(w/2)**2,gy*slope+2*crown*y/(h/2)**2,1.)
            rough=roughness+PARAMS['roughness_jitter']*(2*noise(ix,iy)-1)
            color=reflection(round(nx*2048),round(ny*2048),round(nz*2048),round(rough*1024),yaw)
            i=(iy*w+ix)*4
            pixels[i:i+4]=bytes((*color,round(coverage*255)))
    write_png(OUT/name,w,h,bytes(pixels))
    print(name,flush=True)


def png(source, destination, width, height):
    # 只读复用自../ui-v3/design.py的既有确定渲染函数，不执行其模块。
    r,c,g=[C.CDLL(find_library(n)) for n in ['rsvg-2','cairo','gobject-2.0']]
    ptr=C.c_void_p
    def fn(lib,name,args,result):
        f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
    class Rect(C.Structure):
        _fields_=[(n,C.c_double) for n in ['x','y','width','height']]
    load=fn(r,'rsvg_handle_new_from_file',[C.c_char_p,ptr],ptr)
    surface=fn(c,'cairo_image_surface_create',[C.c_int,C.c_int,C.c_int],ptr)(0,width,height)
    context=fn(c,'cairo_create',[ptr],ptr)(surface)
    handle=load(str(source).encode(),None)
    try:
        ok=fn(r,'rsvg_handle_render_document',[ptr,ptr,C.POINTER(Rect),ptr],C.c_int)(handle,context,C.byref(Rect(0,0,width,height)),None)
        if not ok:raise RuntimeError('设计图渲染失败：'+str(source))
        if fn(c,'cairo_surface_write_to_png',[ptr,C.c_char_p],C.c_int)(surface,str(destination).encode()):raise RuntimeError('设计图保存失败')
    finally:
        fn(c,'cairo_destroy',[ptr],None)(context)
        fn(c,'cairo_surface_destroy',[ptr],None)(surface)
        fn(g,'g_object_unref',[ptr],None)(handle)


def study():
    a=['<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1200" viewBox="0 0 1440 1200">',
       '<style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif}</style>',
       '<rect width="1440" height="1200" fill="#17191b"/>']
    def text(x,y,s,size=16,color='#eeeae0'):
        from html import escape
        a.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}">{escape(s)}</text>')
    def rect(x,y,w,h,color):a.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{color}"/>')
    def image(name,x,y,w,h):
        data=base64.b64encode((OUT/name).read_bytes()).decode()
        a.append(f'<image x="{x}" y="{y}" width="{w}" height="{h}" href="data:image/png;base64,{data}"/>')
    text(32,48,'M2a · 香槟金离线反射研究',28)
    text(32,82,'研究候选 / 尚未采用 · 固定环境 + 几何法线 + GGX微表面；不画条纹，不使用时间动画',16,'#bdb6a8')
    for x,bg,fg,title in [(32,'#101112','#f4f1e8','同一资源 · 黑底'),(736,'#f7f6f2','#1e1c18','同一资源 · 白底')]:
        rect(x,112,672,220,bg)
        text(x+24,150,title,20,fg)
        for dx,name,label in [(32,'button-polished.png','抛光 · r=0.18'),(352,'button-matte.png','细磨砂 · r=0.34')]:
            text(x+dx,183,label,14,fg)
            image(name,x+dx,204,240,44)
            text(x+dx+72,232,'保存设置',16,'#17140d')
        text(x+24,297,'240×44 原尺寸；只改变展示背景，不替换反射环境',14,fg)
    for x,name,title in [(32,'tile-polished.png','480×240 观察片 · 抛光'),(736,'tile-matte.png','480×240 观察片 · 细磨砂')]:
        rect(x,356,672,376,'#222527')
        text(x+24,396,title,20)
        image(name,x+96,426,480,240)
        text(x+24,704,'独立几何；微结构改变粗糙度，未绘制任何可见等距线',14,'#bdb6a8')
    rect(32,756,1376,310,'#222527')
    text(56,800,'关系对照 · 同一按钮几何，固定环境偏转',20)
    for x,name,label in [(112,'button-yaw-minus.png','环境 -12°'),(600,'button-polished.png','环境 0°'),(1088,'button-yaw-plus.png','环境 +12°')]:
        text(x,840,label,14,'#bdb6a8');image(name,x,860,240,44)
    image('plane-reference.png',112,960,240,44)
    text(392,983,'无倒角/无冠形的平面：同一法线看到同一环境，表面基本均匀',16)
    text(56,1042,'反射差异来自几何与环境；冠形很弱，候选外观仍需独立设计判断',14,'#bdb6a8')
    text(32,1110,'参数：F0=(0.91, 0.68, 0.31) 设计近似 · 64点固定采样 · seed 20261103',16,'#bdb6a8')
    text(32,1142,'不是测量纯金；省略光谱/偏振/互反射。此图是设计产物，不是运行或验收截图。',16,'#bdb6a8')
    text(32,1174,'定义与源代码：MATERIAL-DEFINITION.md / parameters.json / render_material.py',14,'#bdb6a8')
    a.append('</svg>')
    target=ROOT/'material-study.svg';target.write_text('\n'.join(a))
    png(target,ROOT/'material-study.png',1440,1200)


if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    (ROOT/'parameters.json').write_text(json.dumps(PARAMS,ensure_ascii=False,indent=2)+'\n')
    for family,rough in [('polished',.18),('matte',.34)]:
        generate('button-'+family+'.png',PARAMS['button'],rough)
        generate('tile-'+family+'.png',PARAMS['tile'],rough)
    generate('button-yaw-minus.png',PARAMS['button'],.18,-12)
    generate('button-yaw-plus.png',PARAMS['button'],.18,12)
    generate('plane-reference.png',PARAMS['button'],.18,plane=True)
    study()
    print('material-study.svg + material-study.png 已生成',flush=True)
