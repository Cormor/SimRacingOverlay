"""单场景共同布局；复用v1已审数值路径，不联网、不写运行资产。"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import copy
import json
import math
import time
from ring_mesh import ring_mesh
import core_physical as core

ROOT=Path(__file__).resolve().parent
BASE=ROOT/'core_physical.py'


def dataset(p,output,input_directory):
    source=Path(p['data']['snapshot_directory'])
    if not source.is_absolute():source=input_directory/source
    raw=(source/'Johnson.yml').read_bytes()
    sha=core.digest(raw)
    if sha!=p['data']['expected_sha256']:raise RuntimeError('JC输入快照与已批准材料基准不一致')
    target=output/'data';target.mkdir(exist_ok=True)
    for name in ['Johnson.yml','LICENSE-CC0.txt','provenance.json']:
        (target/name).write_bytes((source/name).read_bytes())
    rows=[]
    for line in raw.decode().splitlines():
        fields=line.split()
        if len(fields)!=3:continue
        try:rows.append(tuple(float(value) for value in fields))
        except ValueError:continue
    if not rows:raise RuntimeError('JC快照中没有nk数值')
    factor={'um':1000.,'nm':1.}[p['data']['wavelength_input_unit']]
    return [row[0]*factor for row in rows],[row[1] for row in rows],[row[2] for row in rows],sha


def scene_dictionary(mi,p,work,waves,n,k,light_caches):
    T=mi.ScalarAffineTransform4f;b=p['board'];r=p['renderer'];cam=p['camera'];g=p['geometry'];light=p['lighting']
    sec=1/math.cos(math.radians(g['tilt_x_degrees'])) if g['projection_compensation_y'] else 1.
    common=T.rotate([1,0,0],g['tilt_x_degrees'])@T.scale([1,sec,1])
    camera=T.look_at(origin=cam['origin_m'],target=cam['target_m'],up=cam['up'])@T.scale([cam['frame_width_m']/2,cam['frame_width_m']/2,1])
    material=dict(p['material'])
    material['eta']={'type':'irregular','wavelengths':','.join(map(str,waves)),'values':','.join(map(str,n))}
    material['k']={'type':'irregular','wavelengths':','.join(map(str,waves)),'values':','.join(map(str,k))}
    scene={'type':'scene','integrator':{'type':'path','max_depth':r['max_depth'],'hide_emitters':r['hide_emitters']},
           'sensor':{'type':'orthographic','to_world':camera,'sampler':{'type':'independent','sample_count':r['samples_per_pixel']},
                     'film':{'type':'hdrfilm','width':r['film_width'],'height':r['film_height'],'pixel_format':'rgba','component_format':'float32','rfilter':{'type':'box'}}},
           'environment':{'type':'constant','radiance':{'type':light['spectrum'],'scale':light['environment_scale']}}}
    meshes=[];mpp=b['metres_per_pixel']
    for item in p['controls']:
        mesh_params={'geometry':dict(g,projected_width_mm=item['width']*mpp*1000,projected_height_mm=item['height']*mpp*1000),'metres_per_pixel':mpp}
        mesh=work/(item['id']+'.obj');mesh_info=ring_mesh(mesh_params,mesh)
        mesh_info['sha256']=core.digest(mesh.read_bytes())
        center=[(item['x']+item['width']/2-b['width']/2)*mpp,(b['height']/2-item['y']-item['height']/2)*mpp,0.]
        transform=common@T.translate(center)
        scene[item['id']]={'type':'obj','filename':str(mesh),'to_world':transform,'bsdf':copy.deepcopy(material)}
        mesh_info['projected_center_m']=center[:2];mesh_info['center_z_m']=math.tan(math.radians(g['tilt_x_degrees']))*center[1]
        meshes.append(mesh_info)
    for area in light['areas']:
        width,height=area['size_m']
        transform=T.translate(area['center_m'])@T.rotate([0,0,1],area['rotation_z_degrees'])@T.rotate([1,0,0],180)@T.scale([width/2,height/2,1])
        radiance={'type':light['spectrum'],'scale':area['radiance_scale']}
        if area['id'] in light_caches:
            radiance['texture']={'type':'bitmap','filename':str(light_caches[area['id']]),'raw':True,'format':'variant','filter_type':'bilinear','wrap_mode':'clamp'}
        shape={'type':'rectangle','to_world':transform,'emitter':{'type':'area','radiance':radiance}}
        if 'surface_reflectance' in area:shape['bsdf']={'type':'diffuse','reflectance':area['surface_reflectance']}
        scene[area['id']]=shape
    return scene,meshes


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--params',type=Path,default=ROOT/'params.json')
    parser.add_argument('--work-root',type=Path,required=True);parser.add_argument('--output-root',type=Path,required=True)
    args=parser.parse_args();raw=args.params.read_bytes();p=json.loads(raw)
    work=args.work_root.resolve();output=args.output_root.resolve();work.mkdir(parents=True,exist_ok=True);output.mkdir(parents=True,exist_ok=True)
    (output/'params.json').write_bytes(raw)
    waves,n,k,data_sha=dataset(p,output,args.params.resolve().parent)
    import numpy as np
    import mitsuba as mi
    import drjit as dr
    r=p['renderer'];mi.set_variant(r['variant']);dr.set_thread_count(r['cpu_thread_limit'])
    from light_field import create_light_caches
    light_caches,light_records=create_light_caches(mi,p,output)
    scene_dict,meshes=scene_dictionary(mi,p,work,waves,n,k,light_caches)
    resolved=core.serialize_scene(scene_dict);core.json_write(work/'scene-resolved.json',resolved);core.json_write(output/'scene-resolved.json',resolved)
    metadata={'baseline':p['baseline'],'surface_target':p['surface_target'],'input_sha256':core.digest(raw),'script_sha256':core.digest(Path(__file__).read_bytes()),
              'base_script_sha256':core.digest(BASE.read_bytes()),'ring_mesh_sha256':core.digest((ROOT/'ring_mesh.py').read_bytes()),
              'presentation_sha256':core.digest((ROOT/'ring_presentation.py').read_bytes()),'vector_algorithm_sha256':core.digest((ROOT/'draw_vector.py').read_bytes()),
              'light_field_sha256':core.digest((ROOT/'light_field.py').read_bytes()),'light_cache':light_records,
              'data_sha256':data_sha,'dataset_reused_without_network':True,
              'mitsuba':mi.__version__,'drjit':dr.__version__,'numpy':np.__version__,'variant':mi.variant(),
              'cpu_thread_limit':r['cpu_thread_limit'],'meshes':meshes,'started_at_utc':datetime.now(timezone.utc).isoformat()}
    core.json_write(output/'generation.json',metadata)
    scene=mi.load_dict(scene_dict);total=r['samples_per_pixel'];per_pass=r['samples_per_pass'];done=0;pass_index=0;accumulated=None
    started=time.perf_counter()
    while done<total:
        spp=min(per_pass,total-done);seed=r['seed']+pass_index
        print(f'共同布局物理积分 {done}/{total} spp，pass={pass_index}, seed={seed}',flush=True)
        image=np.asarray(mi.render(scene,seed=seed,spp=spp),dtype=np.float64)
        if accumulated is None:accumulated=np.zeros_like(image)
        accumulated+=image*spp;done+=spp;pass_index+=1
    linear=(accumulated/total).astype(np.float32);mi.Bitmap(linear).write(str(output/'render-linear.exr'))
    ev=p['display']['exposure_ev'];core.write_png(mi,linear,output/'render-display-2x.png',ev)
    b=p['board'];height,width,_=linear.shape;scale_x=width/b['width'];scale_y=height/b['height']
    native=core.area_filter(linear,[0.,0.,float(width),float(height)],b['width'],b['height'])
    core.write_png(mi,native,output/'layout-1x.png',ev)
    for item in p['controls']:
        roi=[item['x']*scale_x,item['y']*scale_y,item['width']*scale_x,item['height']*scale_y]
        for scale in [1,2]:
            surface=core.area_filter(linear,roi,max(1,int(round(item['width']*scale))),max(1,int(round(item['height']*scale))))
            core.write_png(mi,surface,output/(item['id']+f'-ring-{scale}x.png'),ev)
    metadata.update({'finished_at_utc':datetime.now(timezone.utc).isoformat(),'elapsed_seconds':time.perf_counter()-started,
                     'total_spp':done,'passes':pass_index,'display_mapping':'linear area/coverage mean, unpremultiply, 0EV, clip for display, sRGB',
                     'status':'design_generated_not_runtime_acceptance'})
    (output/'render_layout.py').write_bytes(Path(__file__).read_bytes())
    for name in ['core_physical.py','ring_mesh.py','ring_presentation.py','light_field.py','draw_vector.py','requirements.txt','README.md','DEFINITION.md']:
        (output/name).write_bytes((ROOT/name).read_bytes())
    from draw_vector import generate
    generate(p,output/'svg')
    from ring_presentation import export_ring_board
    export_ring_board(output,p,core.svg_to_png)
    metadata['output_bytes']={path.name:path.stat().st_size for path in output.iterdir() if path.is_file() and path.suffix in ['.png','.svg','.exr']}
    core.json_write(output/'generation.json',metadata)
    print('共同布局EXR、1x/2x控件与黑白设计图已保存：'+str(output),flush=True)


if __name__=='__main__':main()
