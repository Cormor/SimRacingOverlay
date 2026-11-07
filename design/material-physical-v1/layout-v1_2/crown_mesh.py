"""短轴真实高度变形；cap行条带与倒角共享边界索引，非仅修改法线。"""
import math


def crown_mesh(parameters,target):
    g=parameters['geometry'];mm=.001
    w,h=g['projected_width_mm']*mm,g['projected_height_mm']*mm
    radius=g['corner_radius_mm']*mm;bw=g['bevel_width_mm']*mm
    bh=g['bevel_height_mm']*mm;thickness=g['thickness_mm']*mm
    crown=g['crown_height_mm']*mm;a=h/2-bw
    corner_segments=g['corner_segments'];side_segments=g['crown_straight_segments'];steps=g['bevel_segments']
    def displacement(y):
        if abs(y)>=a:return 0.,0.
        q=1-(y/a)**2
        return crown*q*q,-4*crown*y/(a*a)*q
    perimeter=[]
    # 与v1相同逆时针圆角参数，左右直边增加Y分段。
    for cx,cy,start in [(w/2-radius,h/2-radius,0),(-w/2+radius,h/2-radius,90),(-w/2+radius,-h/2+radius,180),(w/2-radius,-h/2+radius,270)]:
        for index in range(corner_segments+1):
            angle=math.radians(start+90*index/corner_segments)
            perimeter.append((cx,cy,math.cos(angle),math.sin(angle)))
        if start==90:
            for index in range(1,side_segments):
                y=(h/2-radius)*(1-2*index/side_segments)
                perimeter.append((-w/2+radius,y,-1.,0.))
        elif start==270:
            for index in range(1,side_segments):
                y=(-h/2+radius)*(1-2*index/side_segments)
                perimeter.append((w/2-radius,y,1.,0.))
    vertices=[];normals=[];faces=[];rings=[]
    for step in range(steps+1):
        t=(math.pi/2)*step/steps;r=radius-bw+bw*math.sin(t);z=-bh*(1-math.cos(t));ids=[]
        for cx,cy,dx,dy in perimeter:
            x,y=cx+r*dx,cy+r*dy
            shift,slope=displacement(y)
            nx,ny,nz=bh*math.sin(t)*dx,bh*math.sin(t)*dy,bw*math.cos(t)
            ny-=slope*nz
            length=math.sqrt(nx*nx+ny*ny+nz*nz)
            ids.append(len(vertices));vertices.append((x,y,z+shift));normals.append((nx/length,ny/length,nz/length))
        rings.append(ids)
    # 顶cap的每个Y行取圆角/直边共享的左右边界顶点，真实三角条带。
    rows={}
    for index in rings[0]:
        x,y,z=vertices[index]
        rows.setdefault(round(y,12),[]).append(index)
    cap=[]
    for y,indices in sorted(rows.items()):
        left=min(indices,key=lambda i:vertices[i][0]);right=max(indices,key=lambda i:vertices[i][0])
        cap.append((left,right))
    for (left,right),(next_left,next_right) in zip(cap,cap[1:]):
        faces.extend([(left,right,next_right),(left,next_right,next_left)])
    count=len(perimeter)
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
    lines=['# Au physical crown: true Y strips and Jacobian normals; flat bottom']
    lines+=['v '+' '.join(f'{value:.12g}' for value in point) for point in vertices]
    lines+=['vn '+' '.join(f'{value:.12g}' for value in normal) for normal in normals]
    lines+=['f '+' '.join(f'{index+1}//{index+1}' for index in face) for face in faces]
    target.write_text('\n'.join(lines)+'\n')
    return {'vertices':len(vertices),'triangles':len(faces),'cap_y_rows':len(cap),'straight_segments':side_segments,
            'crown_height_mm':g['crown_height_mm'],'crown_half_height_mm':a*1000,'path':str(target)}
