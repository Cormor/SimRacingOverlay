"""唯一Au光谱基准。params.json是真输入；无测试/扫描/旧图处理/运行版写入。"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import base64
import ctypes as C
from ctypes.util import find_library
import hashlib
import json
import math
import struct
import time
import urllib.request
import zlib

ROOT=Path(__file__).resolve().parent


def digest(data):return hashlib.sha256(data).hexdigest()
def json_write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')


def fetch(url):
    request=urllib.request.Request(url,headers={'User-Agent':'Au-physical-design-baseline/1.0'})
    with urllib.request.urlopen(request,timeout=30) as response:return response.read()


def acquire_data(parameters,work):
    target=work/'data';target.mkdir(parents=True,exist_ok=True)
    info=parameters['data'];commit=None;commit_error=None
    api='https://api.github.com/repos/'+info['repository']+'/commits/'+info['branch']
    try:commit=json.loads(fetch(api))['sha']
    except Exception as error:commit_error=str(error)
    revision=commit or info['branch']
    base='https://raw.githubusercontent.com/'+info['repository']+'/'+revision+'/'
    url=base+info['path'];raw=fetch(url)
    license_raw=fetch(base+'LICENSE')
    (target/'Johnson.yml').write_bytes(raw);(target/'LICENSE-CC0.txt').write_bytes(license_raw)
    provenance={'doi':info['doi'],'repository':info['repository'],'commit':commit,
                'commit_lookup_error':commit_error,'url':url,
                'original_url':'https://raw.githubusercontent.com/'+info['repository']+'/'+info['branch']+'/'+info['path'],
                'retrieved_at_utc':datetime.now(timezone.utc).isoformat(),
                'sha256':digest(raw),'license':info['license'],'license_url':base+'LICENSE',
                'source_kind':'refractiveindex.info维护者公开录入，非实验室原始数据仓'}
    json_write(target/'provenance.json',provenance)
    rows=[]
    for line in raw.decode().splitlines():
        pieces=line.split()
        if len(pieces)!=3:continue
        try:rows.append(tuple(float(part) for part in pieces))
        except ValueError:continue
    if not rows:raise RuntimeError('来源没有tabulated nk数值，停止渲染')
    factor={'um':1000.0,'nm':1.0}[info['wavelength_input_unit']]
    wavelengths=[row[0]*factor for row in rows]
    n=[row[1] for row in rows];k=[row[2] for row in rows]
    for name,values in [('eta',n),('k',k)]:
        (target/(name+'.spd')).write_text(''.join(f'{wave:.10g} {value:.10g}\n' for wave,value in zip(wavelengths,values)))
    return wavelengths,n,k,provenance


def plate_mesh(parameters,target):
    g=parameters['geometry'];mm=.001
    w,h=g['projected_width_mm']*mm,g['projected_height_mm']*mm
    radius=g['corner_radius_mm']*mm;bw=g['bevel_width_mm']*mm
    bh=g['bevel_height_mm']*mm;thickness=g['thickness_mm']*mm
    segments=g['corner_segments'];steps=g['bevel_segments']
    perimeter=[]
    for cx,cy,start in [(w/2-radius,h/2-radius,0),(-w/2+radius,h/2-radius,90),(-w/2+radius,-h/2+radius,180),(w/2-radius,-h/2+radius,270)]:
        for index in range(segments+1):
            angle=math.radians(start+90*index/segments)
            perimeter.append((cx,cy,math.cos(angle),math.sin(angle)))
    vertices=[(0.,0.,0.)];normals=[(0.,0.,1.)];faces=[];rings=[]
    for step in range(steps+1):
        t=(math.pi/2)*step/steps;r=radius-bw+bw*math.sin(t);z=-bh*(1-math.cos(t));ids=[]
        for cx,cy,dx,dy in perimeter:
            nx,ny,nz=bh*math.sin(t)*dx,bh*math.sin(t)*dy,bw*math.cos(t)
            length=math.sqrt(nx*nx+ny*ny+nz*nz)
            ids.append(len(vertices));vertices.append((cx+r*dx,cy+r*dy,z));normals.append((nx/length,ny/length,nz/length))
        rings.append(ids)
    count=len(perimeter)
    for i in range(count):faces.append((0,rings[0][i],rings[0][(i+1)%count]))
    for inner,outer in zip(rings,rings[1:]):
        for i in range(count):
            j=(i+1)%count;faces.extend([(inner[i],outer[i],outer[j]),(inner[i],outer[j],inner[j])])
    wall=[]
    for cx,cy,dx,dy in perimeter:
        wall.append(len(vertices));vertices.append((cx+radius*dx,cy+radius*dy,-thickness));normals.append((dx,dy,0.))
    for i in range(count):
        j=(i+1)%count;faces.extend([(rings[-1][i],wall[i],wall[j]),(rings[-1][i],wall[j],rings[-1][j])])
    back_center=len(vertices);vertices.append((0.,0.,-thickness));normals.append((0.,0.,-1.))
    back=[]
    for cx,cy,dx,dy in perimeter:
        back.append(len(vertices));vertices.append((cx+radius*dx,cy+radius*dy,-thickness));normals.append((0.,0.,-1.))
    for i in range(count):faces.append((back_center,back[(i+1)%count],back[i]))
    lines=['# Au physical baseline: explicit geometry and vertex normals']
    lines += ['v '+' '.join(f'{v:.12g}' for v in point) for point in vertices]
    lines += ['vn '+' '.join(f'{v:.12g}' for v in normal) for normal in normals]
    lines += ['f '+' '.join(f'{index+1}//{index+1}' for index in face) for face in faces]
    target.write_text('\n'.join(lines)+'\n')
    return {'vertices':len(vertices),'triangles':len(faces),'path':str(target)}


def scene_dictionary(mi,p,mesh,waves,n,k):
    T=mi.ScalarAffineTransform4f;g=p['geometry'];r=p['renderer'];cam=p['camera'];light=p['lighting']
    cosine=math.cos(math.radians(g['tilt_x_degrees']))
    scale_y=1/cosine if g['projection_compensation_y'] else 1.
    plate_transform=T.rotate([1,0,0],g['tilt_x_degrees'])@T.scale([1,scale_y,1])
    camera_transform=T.look_at(origin=cam['origin_m'],target=cam['target_m'],up=cam['up'])@T.scale([cam['frame_width_m']/2,cam['frame_width_m']/2,1])
    material=dict(p['material'])
    material['eta']={'type':'irregular','wavelengths':','.join(map(str,waves)),'values':','.join(map(str,n))}
    material['k']={'type':'irregular','wavelengths':','.join(map(str,waves)),'values':','.join(map(str,k))}
    scene={'type':'scene','integrator':{'type':'path','max_depth':r['max_depth'],'hide_emitters':r['hide_emitters']},
           'sensor':{'type':'orthographic','to_world':camera_transform,
                     'sampler':{'type':'independent','sample_count':r['samples_per_pixel']},
                     'film':{'type':'hdrfilm','width':r['film_width'],'height':r['film_height'],
                             'pixel_format':'rgba','component_format':'float32','rfilter':{'type':'box'}}},
           'plate':{'type':'obj','filename':str(mesh),'to_world':plate_transform,'bsdf':material},
           'environment':{'type':'constant','radiance':{'type':light['spectrum'],'scale':light['environment_scale']}}}
    for area in light['areas']:
        width,height=area['size_m']
        transform=T.translate(area['center_m'])@T.rotate([1,0,0],180)@T.scale([width/2,height/2,1])
        scene[area['id']]={'type':'rectangle','to_world':transform,'emitter':{'type':'area','radiance':{'type':light['spectrum'],'scale':area['radiance_scale']}}}
    return scene


def serialize_scene(value):
    if isinstance(value,dict):return {key:serialize_scene(child) for key,child in value.items()}
    if isinstance(value,list):return [serialize_scene(child) for child in value]
    if hasattr(value,'matrix'):
        import numpy as np
        return {'type':'affine_transform','matrix':np.asarray(value.matrix).tolist()}
    return value


def area_filter(array,roi,width,height):
    """精确格点覆盖面积权重；RGBA在线性域同时累计，尚未sRGB编码。"""
    import numpy as np
    x0,y0,rw,rh=roi;source_h,source_w,_=array.shape
    def weights(length,start,extent,count):
        low=start+np.arange(count)*extent/count;high=low+extent/count
        cells=np.arange(length)
        overlap=np.maximum(0,np.minimum(high[:,None],cells[None,:]+1)-np.maximum(low[:,None],cells[None,:]))
        return overlap/(extent/count)
    wx=weights(source_w,x0,rw,width);wy=weights(source_h,y0,rh,height)
    return np.einsum('yh,hwc,xw->yxc',wy,array,wx,optimize=True)


def write_png(mi,array,path,exposure):
    import numpy as np
    alpha=np.clip(array[:,:,3:4],0.,1.)
    rgb=np.divide(array[:,:,:3],alpha,out=np.zeros_like(array[:,:,:3]),where=alpha>1e-8)*2**exposure
    rgb=np.clip(rgb,0.,1.)
    encoded=np.where(rgb<=.0031308,12.92*rgb,1.055*rgb**(1/2.4)-.055)
    rgba=np.concatenate([encoded,alpha],axis=2)
    mi.Bitmap(np.rint(rgba*255).astype(np.uint8)).write(str(path))


def export_board(output,p):
    data='data:image/png;base64,'+base64.b64encode((output/'surface-native.png').read_bytes()).decode()
    large='data:image/png;base64,'+base64.b64encode((output/'render-display.png').read_bytes()).decode()
    nodes=['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="780" viewBox="0 0 1200 780">',
           '<style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif}</style><rect width="1200" height="780" fill="#17191b"/>']
    def text(x,y,value,size=16,color='#f4f1e8'):
        from html import escape
        nodes.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}">{escape(value)}</text>')
    text(32,48,'Au-JC1972 · 固定光谱物理生成',28)
    text(32,82,'实测η/k / GGX / 有限面积光 / 正交投影 · 同一场景，不是AI纹理',16,'#bdb6a8')
    for x,bg,fg in [(32,'#101112','#f4f1e8'),(616,'#f7f6f2','#1e1c18')]:
        nodes.append(f'<rect x="{x}" y="112" width="552" height="240" rx="16" fill="{bg}"/>')
        text(x+24,153,'240×44原尺寸 · 黑底' if x==32 else '240×44原尺寸 · 白底',20,fg)
        nodes.append(f'<image x="{x+156}" y="192" width="240" height="44" href="{data}"/>')
        text(x+24,286,'只改变上下文，物体、灯光、曝光与像素颜色相同',14,fg)
        text(x+24,320,'物理素材不烘焙文字、UI边框或hover辉光',14,fg)
    text(32,398,'960×176原始渲染视区 · 同一薄片，含10%相机边距',20)
    nodes.append(f'<image x="120" y="424" width="960" height="176" href="{large}"/>')
    text(32,650,'alpha=0.02为工程选择；1024spp非无噪保证。线性EXR保存原始辐亮度，显示0EV与sRGB。',15,'#bdb6a8')
    text(32,688,'Johnson–Christy数据为维护者公开录入；非实物照明复刻。当前仅离线设计，不覆盖运行版。',15,'#bdb6a8')
    text(32,726,'输入params.json / resolved scene / 原始数据来源与脚本版本均随交付保存。',15,'#bdb6a8')
    nodes.append('</svg>');svg=output/'physical-study.svg';svg.write_text('\n'.join(nodes))
    svg_to_png(svg,output/'physical-study.png',1200,780)


def svg_to_png(source,destination,width,height):
    r,c,g=[C.CDLL(find_library(name)) for name in ['rsvg-2','cairo','gobject-2.0']];ptr=C.c_void_p
    def fn(lib,name,args,result):
        f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
    class Rect(C.Structure):_fields_=[(name,C.c_double) for name in ['x','y','width','height']]
    surface=fn(c,'cairo_image_surface_create',[C.c_int,C.c_int,C.c_int],ptr)(0,width,height)
    context=fn(c,'cairo_create',[ptr],ptr)(surface)
    handle=fn(r,'rsvg_handle_new_from_file',[C.c_char_p,ptr],ptr)(str(source).encode(),None)
    try:
        ok=fn(r,'rsvg_handle_render_document',[ptr,ptr,C.POINTER(Rect),ptr],C.c_int)(handle,context,C.byref(Rect(0,0,width,height)),None)
        if not ok:raise RuntimeError('设计SVG导出失败')
        result=fn(c,'cairo_surface_write_to_png',[ptr,C.c_char_p],C.c_int)(surface,str(destination).encode())
        if result:raise RuntimeError('设计PNG保存失败')
    finally:
        fn(c,'cairo_destroy',[ptr],None)(context);fn(c,'cairo_surface_destroy',[ptr],None)(surface);fn(g,'g_object_unref',[ptr],None)(handle)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--params',type=Path,default=ROOT/'params.json')
    parser.add_argument('--work-root',type=Path,required=True);parser.add_argument('--output-root',type=Path,required=True)
    args=parser.parse_args();raw=args.params.read_bytes();p=json.loads(raw)
    work=args.work_root.resolve();output=args.output_root.resolve();work.mkdir(parents=True,exist_ok=True);output.mkdir(parents=True,exist_ok=True)
    (output/'params-input.json').write_bytes(raw)
    print('读取真实输入与取得JC1972数据',flush=True)
    waves,n,k,provenance=acquire_data(p,work)
    mesh=work/'plate.obj';mesh_info=plate_mesh(p,mesh)
    import numpy as np
    import mitsuba as mi
    import drjit as dr
    mi.set_variant(p['renderer']['variant'])
    dr.set_thread_count(8)
    scene_dict=scene_dictionary(mi,p,mesh,waves,n,k)
    resolved=serialize_scene(scene_dict);json_write(work/'scene-resolved.json',resolved);json_write(output/'scene-resolved.json',resolved)
    metadata={'baseline':p['baseline'],'input_sha256':digest(raw),'script_sha256':digest(Path(__file__).read_bytes()),
              'mitsuba':mi.__version__,'drjit':dr.__version__,'numpy':np.__version__,'cpu_thread_limit':8,'variant':mi.variant(),'mesh':mesh_info,
              'data':provenance,'started_at_utc':datetime.now(timezone.utc).isoformat()}
    json_write(output/'generation.json',metadata)
    scene=mi.load_dict(scene_dict)
    r=p['renderer'];total=r['samples_per_pixel'];per_pass=r['samples_per_pass'];accumulated=None;done=0;pass_index=0
    started=time.perf_counter()
    while done<total:
        spp=min(per_pass,total-done);seed=r['seed']+pass_index
        print(f'物理积分 {done}/{total} spp，pass={pass_index}, seed={seed}',flush=True)
        image=np.asarray(mi.render(scene,seed=seed,spp=spp),dtype=np.float64)
        if accumulated is None:accumulated=np.zeros_like(image)
        accumulated+=image*spp;done+=spp;pass_index+=1
    linear=(accumulated/total).astype(np.float32)
    mi.Bitmap(linear).write(str(output/'render-linear.exr'))
    display=p['display'];write_png(mi,linear,output/'render-display.png',display['exposure_ev'])
    h,w,_=linear.shape
    if display['crop_to_projected_front']:
        crop_width=w*(p['geometry']['projected_width_mm']*.001)/p['camera']['frame_width_m']
        frame_height=p['camera']['frame_width_m']*h/w
        crop_height=h*(p['geometry']['projected_height_mm']*.001)/frame_height
        roi=[(w-crop_width)/2,(h-crop_height)/2,crop_width,crop_height]
    else:roi=[0.,0.,float(w),float(h)]
    native=area_filter(linear,roi,display['native_width'],display['native_height'])
    write_png(mi,native,output/'surface-native.png',display['exposure_ev'])
    metadata.update({'finished_at_utc':datetime.now(timezone.utc).isoformat(),'elapsed_seconds':time.perf_counter()-started,
                     'total_spp':done,'passes':pass_index,'native_roi_render_pixels':roi,
                     'display_mapping':'linear area/coverage mean, unpremultiply, 0EV, clip for display, sRGB',
                     'status':'design_generated_not_runtime_acceptance'})
    json_write(output/'generation.json',metadata)
    (output/'render_physical.py').write_bytes(Path(__file__).read_bytes())
    export_board(output,p)
    print('线性EXR、实际场景、原尺寸/大材质片与黑白设计图已保存：'+str(output),flush=True)


if __name__=='__main__':main()
