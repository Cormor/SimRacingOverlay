"""M2b离线研究：保持M2a几何和BRDF，仅改环境/显示映射及UI金属应用面积。"""
from pathlib import Path
from functools import lru_cache
import base64
import copy
import json
import math
import render_material as m

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'assets-m2b'
ENV={'background':[.025,.035],
     'face_box':[0.,0.,1.0,.10,.10],'face_intensity':1.1,
     'key_box':[-.30,-.65,.70,.10,.035],'key_intensity':12.,
     'side_box':[1.0,-.08,.04,.8,.025],'side_intensity':16.}
CAMERA={'exposure':.75,'shoulder':.65,'white_rolloff_start':2.,'white_rolloff_end':8.,
        'white_mix_max':.9}


def environment(x,y,z):
    base=ENV['background'][0]+ENV['background'][1]*max(z,0.)
    if z<=.015:return base
    u,v=x/z,y/z
    return base+ENV['face_intensity']*m.box(u,v,*ENV['face_box'])+ENV['key_intensity']*m.box(u,v,*ENV['key_box'])+ENV['side_intensity']*m.box(u,v,*ENV['side_box'])


def encode(rgb):
    values=[max(0.,c*CAMERA['exposure']) for c in rgb]
    peak=max(values)
    knee=CAMERA['shoulder']
    target=peak if peak<=knee else knee+(1-knee)*(1-math.exp(-(peak-knee)/(1-knee)))
    scale=target/max(peak,1e-8)
    white=CAMERA['white_mix_max']*m.smooth((peak-CAMERA['white_rolloff_start'])/(CAMERA['white_rolloff_end']-CAMERA['white_rolloff_start']))
    result=[]
    for value in values:
        mapped=value*scale*(1-white)+target*white
        srgb=12.92*mapped if mapped<=.0031308 else 1.055*mapped**(1/2.4)-.055
        result.append(min(255,max(0,round(srgb*255))))
    return tuple(result)


@lru_cache(maxsize=200000)
def reflection(qx,qy,qz,qr,yaw_degrees):
    nx,ny,nz=m.normalize(qx,qy,qz)
    roughness=qr/m.PARAMS['roughness_quantization']
    alpha=roughness*roughness
    tx,ty,tz=m.normalize(nz,0,-nx)
    bx,by,bz=ny*tz-nz*ty,nz*tx-nx*tz,nx*ty-ny*tx
    a,b=0.,0.
    gv=m.g1(max(nz,1e-5),alpha)
    for u,v in m.SAMPLES:
        hz=math.sqrt((1-u)/(1+(alpha*alpha-1)*u))
        radius=math.sqrt(max(0.,1-hz*hz));phi=2*math.pi*v
        hx,hy=radius*math.cos(phi),radius*math.sin(phi)
        wx,wy,wz=tx*hx+bx*hy+nx*hz,ty*hx+by*hy+ny*hz,tz*hx+bz*hy+nz*hz
        nl=2*wz*hz-nz
        if wz<=0 or nl<=0:continue
        light=environment(2*wz*wx,2*wz*wy,2*wz*wz-1)
        weight=light*gv*m.g1(nl,alpha)*wz/max(1e-7,nz*hz)
        a+=weight;b+=weight*(1-wz)**5
    count=len(m.SAMPLES)
    return encode([(f0*a+(1-f0)*b)/count for f0 in m.PARAMS['f0_linear_rgb']])


def neutral_family(path,w,h,rgba):
    # 此缓冲由本轮shader计算，未读取或编辑任何现有图。
    original_writer(path,w,h,rgba)
    radius=m.PARAMS['button']['radius']
    for name,face in [('neutral-dark.png',(25,27,29)),('neutral-light.png',(255,255,255))]:
        pixels=bytearray(rgba)
        for iy in range(h):
            for ix in range(w):
                x,y=abs(ix+.5-w/2)-w/2+radius,abs(iy+.5-h/2)-h/2+radius
                distance=math.hypot(max(x,0),max(y,0))+min(max(x,y),0)-radius
                t=m.smooth((-distance-1.7)/.6)
                offset=(iy*w+ix)*4
                for c in range(3):pixels[offset+c]=round(rgba[offset+c]*(1-t)+face[c]*t)
        original_writer(OUT/name,w,h,bytes(pixels))


def study():
    a=['<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="680" viewBox="0 0 1120 680">',
       '<style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif}</style>',
       '<rect width="1120" height="680" fill="#17191b"/>']
    def text(x,y,s,size=16,color='#f4f1e8'):
        from html import escape
        a.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}">{escape(s)}</text>')
    def image(name,x,y):
        data=base64.b64encode((OUT/name).read_bytes()).decode()
        a.append(f'<image x="{x}" y="{y}" width="240" height="44" href="data:image/png;base64,{data}"/>')
    text(32,48,'M2b · 中性面 + 少面积金属反射',28)
    text(32,82,'研究候选 / 尚未采用 · 保持几何、F0及粗糙度，改变固定环境与显示映射',16,'#bdb6a8')
    for x,bg,fg,face in [(32,'#101112','#f4f1e8','neutral-dark.png'),(576,'#f7f6f2','#1e1c18','neutral-light.png')]:
        a.append(f'<rect x="{x}" y="112" width="512" height="410" rx="16" fill="{bg}"/>')
        text(x+24,153,'黑底上下文' if x==32 else '白底上下文',20,fg)
        text(x+40,202,'普通操作：中性面与有反射差别的金属边',14,fg)
        image(face,x+136,228);text(x+136+88,256,'取消',16,fg)
        text(x+40,324,'少数主操作：金属面，文字区域安定',14,fg)
        image('primary.png',x+136,350);text(x+136+72,378,'保存设置',16,'#17140d')
        text(x+24,454,'均为240×44实际尺寸；不将大卡片整面铺金',14,fg)
        text(x+24,488,'两组复用同一反射环境，不模拟桌面实时光照',14,fg)
    text(32,570,'固定条件：圆角8 / 倒角2.2×0.9 / 冠形0.37 / r=0.18 / F0=(0.91,0.68,0.31)',15,'#bdb6a8')
    text(32,606,'变化：中等亮面1.1、窄亮面12/16、暗背景0.025；曝光0.75与明确的显示肩部',15,'#bdb6a8')
    text(32,642,'定义：MATERIAL-M2B.md · parameters-m2b.json · render_m2b.py；未进入共享或运行端',15,'#bdb6a8')
    a.append('</svg>')
    target=ROOT/'m2b-study.svg';target.write_text('\n'.join(a))
    m.png(target,ROOT/'m2b-study.png',1120,680)


if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    params=copy.deepcopy(m.PARAMS);params['environment']=ENV;params['camera']=CAMERA
    params.pop('tile',None)
    params['roughness']={'polished':.18}
    params['environment_yaw_degrees']=[0]
    params['tone_mapping']='exposure; maximum-channel shoulder; highlight convergence; sRGB'
    params['candidate']='M2b';params['application']='neutral face with small metal border; selected primary only'
    (ROOT/'parameters-m2b.json').write_text(json.dumps(params,ensure_ascii=False,indent=2)+'\n')
    original_writer=m.write_png
    m.OUT=OUT;m.reflection=reflection;m.write_png=neutral_family
    m.generate('primary.png',m.PARAMS['button'],.18)
    study()
    print('m2b-study.svg + m2b-study.png 已生成',flush=True)
