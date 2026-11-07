"""复用v1已审线性滤波/编码/序列化及SVG预览导出；无联网或渲染main。"""
import hashlib
import json
import ctypes as C
from ctypes.util import find_library


def digest(data):return hashlib.sha256(data).hexdigest()

def json_write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')



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

