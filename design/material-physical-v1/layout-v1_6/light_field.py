"""有限摄影棚屏的解析标量发光分布；EXR仅为离线线性采样缓存。"""
from pathlib import Path


def create_light_caches(mi,p,output):
    import numpy as np
    caches={};records=[]
    def window(x,inner,outer):
        q=np.clip((np.abs(x)-inner)/(outer-inner),0.,1.)
        return 1.-q*q*(3.-2.*q)
    for area in p['lighting']['areas']:
        profile=area.get('soft_profile')
        if profile is None:continue
        if profile['type']!='wide_shoulder_smoothstep':raise ValueError('未定义的发光profile')
        width,height=area['size_m'];nx,ny=profile['resolution']
        u=(np.arange(nx)+.5)/nx;v=(np.arange(ny)+.5)/ny
        # rectangle UV经Rx180后local+y向负t；行号对应v，不再翻转。
        s=width*(u[None,:]-.5);t=-height*(v[:,None]-.5)
        broad=window(s,*profile['broad_s_m'])*window(t,*profile['broad_t_m'])
        key=window(s,*profile['key_s_m'])*window(t,*profile['key_t_m'])
        amplitude=profile['floor']+profile['broad_gain']*broad+profile['key_gain']*key
        if profile['boundary_floor']:
            amplitude[[0,-1],:]=profile['floor'];amplitude[:,[0,-1]]=profile['floor']
        image=np.ascontiguousarray(amplitude[:,:,None],dtype=np.float32)
        path=output/profile['cache_file'];path.parent.mkdir(parents=True,exist_ok=True)
        mi.Bitmap(image).write(str(path));caches[area['id']]=path
        def integral(pair):return pair[0]+pair[1]
        analytic=(profile['floor']*width*height+
                  profile['broad_gain']*integral(profile['broad_s_m'])*integral(profile['broad_t_m'])+
                  profile['key_gain']*integral(profile['key_s_m'])*integral(profile['key_t_m']))
        records.append({'area_id':area['id'],'relative_cache':profile['cache_file'],'channels':1,
                        'shape':[ny,nx,1],'format':'float32 linear raw','filter':'bilinear/clamp',
                        'amplitude_min':float(image.min()),'amplitude_max':float(image.max()),
                        'discrete_mean_amplitude':float(amplitude.mean()),'analytic_integral_m2':analytic,
                        'role':'offline discretization of spectral D65 multiplier, not material color texture'})
    return caches,records
