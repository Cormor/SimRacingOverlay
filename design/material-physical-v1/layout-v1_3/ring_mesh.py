"""闭合金属边环：真实跨宽sin²微曲面、内外薄壁与平底环；中央不建面。"""
import math


def ring_mesh(parameters,target):
    g=parameters['geometry'];mm=.001
    width,height=g['projected_width_mm']*mm,g['projected_height_mm']*mm
    radius=g['corner_radius_mm']*mm;edge=g['edge_width_mm']*mm
    peak=g['edge_crown_height_mm']*mm;bottom=g['edge_bottom_z_mm']*mm
    corners=g['corner_segments'];steps=g['edge_width_segments'];max_step=g['perimeter_max_step_css']*parameters['metres_per_pixel']
    centers=[(width/2-radius,height/2-radius,0),(-width/2+radius,height/2-radius,90),
             (-width/2+radius,-height/2+radius,180),(width/2-radius,-height/2+radius,270)]
    perimeter=[]
    for corner,(cx,cy,start) in enumerate(centers):
        for index in range(corners+1):
            angle=math.radians(start+90*index/corners)
            perimeter.append((cx,cy,math.cos(angle),math.sin(angle)))
        next_x,next_y,_=centers[(corner+1)%4]
        segments=max(1,math.ceil(math.hypot(next_x-cx,next_y-cy)/max_step))
        tangent_angle=math.radians(start+90);dx,dy=math.cos(tangent_angle),math.sin(tangent_angle)
        for index in range(1,segments):
            t=index/segments
            perimeter.append((cx+(next_x-cx)*t,cy+(next_y-cy)*t,dx,dy))
    vertices=[];normals=[];faces=[];rings=[]
    for step in range(steps+1):
        d=edge*step/steps
        z=peak*math.sin(math.pi*d/edge)**2
        slope=peak*math.pi/edge*math.sin(2*math.pi*d/edge)
        if step in (0,steps):z=0.;slope=0.
        ids=[]
        for cx,cy,dx,dy in perimeter:
            ids.append(len(vertices));vertices.append((cx+(radius-d)*dx,cy+(radius-d)*dy,z))
            nx,ny,nz=slope*dx,slope*dy,1.;length=math.sqrt(nx*nx+ny*ny+nz*nz)
            normals.append((nx/length,ny/length,nz/length))
        rings.append(ids)
    count=len(perimeter)
    for outer,inner in zip(rings,rings[1:]):
        for i in range(count):
            j=(i+1)%count;faces.extend([(outer[i],outer[j],inner[j]),(outer[i],inner[j],inner[i])])
    # 外壁朝外，内壁朝孔；顶和底使用分离法线以保留真实硬边。
    for d,inside in [(0.,False),(edge,True)]:
        top_ids=[];bottom_ids=[];sign=-1. if inside else 1.
        for cx,cy,dx,dy in perimeter:
            x,y=cx+(radius-d)*dx,cy+(radius-d)*dy
            top_ids.append(len(vertices));vertices.append((x,y,0.));normals.append((sign*dx,sign*dy,0.))
            bottom_ids.append(len(vertices));vertices.append((x,y,bottom));normals.append((sign*dx,sign*dy,0.))
        for i in range(count):
            j=(i+1)%count
            if inside:faces.extend([(top_ids[i],top_ids[j],bottom_ids[j]),(top_ids[i],bottom_ids[j],bottom_ids[i])])
            else:faces.extend([(top_ids[i],bottom_ids[i],bottom_ids[j]),(top_ids[i],bottom_ids[j],top_ids[j])])
    bottom_rings=[]
    for d in [0.,edge]:
        ids=[]
        for cx,cy,dx,dy in perimeter:
            ids.append(len(vertices));vertices.append((cx+(radius-d)*dx,cy+(radius-d)*dy,bottom));normals.append((0.,0.,-1.))
        bottom_rings.append(ids)
    outer,inner=bottom_rings
    for i in range(count):
        j=(i+1)%count;faces.extend([(outer[i],inner[i],inner[j]),(outer[i],inner[j],outer[j])])
    lines=['# Real closed gold ring; central aperture has no faces']
    lines+=['v '+' '.join(f'{value:.12g}' for value in point) for point in vertices]
    lines+=['vn '+' '.join(f'{value:.12g}' for value in normal) for normal in normals]
    lines+=['f '+' '.join(f'{index+1}//{index+1}' for index in face) for face in faces]
    target.write_text('\n'.join(lines)+'\n')
    return {'vertices':len(vertices),'triangles':len(faces),'perimeter_samples':count,'width_segments':steps,
            'edge_width_mm':g['edge_width_mm'],'edge_peak_mm':g['edge_crown_height_mm'],'central_surface':False,'path':str(target)}
