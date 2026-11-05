"""PBR预览合成；含PNG，明确不同于svg目录内纯矢量资源。"""
import base64
from html import escape


def export_ring_board(output,p,svg_to_png):
    def uri(name):return 'data:image/png;base64,'+base64.b64encode((output/name).read_bytes()).decode()
    b=p['board'];g=p['geometry'];controls=p['controls'];sample=next((item for item in controls if item['id']=='medium'),controls[len(controls)//2])
    default=controls[0];sw,sh=sample['width'],sample['height'];dw,dh=default['width'],default['height'];radius=g['corner_radius_mm']*.001/b['metres_per_pixel']
    panel_w=max(b['width']+40,sw+220,sw*2+72);board_w=panel_w*2+96
    top_y=112;top_h=b['height']+78;states_y=top_y+top_h+28;row_gap=max(sh,dh)+38;states_h=row_gap*3+100
    zoom_y=states_y+states_h+28;zoom_h=sh*2+112;footer_y=zoom_y+zoom_h+42;board_h=footer_y+88
    layout=uri('layout-1x.png');sample1=uri(sample['id']+'-ring-1x.png');sample2=uri(sample['id']+'-ring-2x.png')
    nodes=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{board_w}" height="{board_h}" viewBox="0 0 {board_w} {board_h}">',
           '<desc>物理预览合成，包含位图。权威算法和真实纯SVG资源见源包，不将本文件称为纯矢量。</desc>',
           '<style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif}</style>',
           '<defs><filter id="hover-glow" x="-20%" y="-100%" width="140%" height="300%"><feFlood flood-color="#e8c66a" flood-opacity=".42"/><feComposite in2="SourceAlpha" operator="in"/><feGaussianBlur stdDeviation="3.5"/></filter></defs>',
           f'<rect width="{board_w}" height="{board_h}" fill="#17191b"/>']
    def text(x,y,value,size=16,color='#f4f1e8',anchor='start'):
        nodes.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" fill="{color}">{escape(value)}</text>')
    def rect(x,y,w,h,fill,stroke=None,r=8):
        extra='' if stroke is None else f' stroke="{stroke}"'
        nodes.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{extra}/>')
    def image(x,y,w,h,data,extra=''):
        nodes.append(f'<image x="{x}" y="{y}" width="{w}" height="{h}" href="{data}" {extra}/>')
    text(32,46,'单凸半椭圆精抛目标 · PBR物理效果预览',28)
    text(32,80,'α=.006保持 / 同JC与共同大灯 · 算法和真参数为权威源，另附纯SVG几何/工程近似渐变',16,'#bdb6a8')
    for x,canvas,body,fg,border,on_primary,label in [(32,'#101112','#191b1d','#f4f1e8','#555149','#17140d','黑底'),
             (64+panel_w,'#f7f6f2','#ffffff','#1e1c18','#817a6c','#211a08','白底')]:
        rect(x,top_y,panel_w,top_h,canvas,r=16);text(x+20,top_y+31,label+' · 原尺寸强调中性body + 物理ring',19,fg)
        for item in controls:rect(x+20+item['x'],top_y+52+item['y'],item['width'],item['height'],body,r=radius)
        image(x+20,top_y+52,b['width'],b['height'],layout)
        for item in controls:text(x+20+item['x']+item['width']/2,top_y+52+item['y']+item['height']/2+5,'继续',16,fg,'middle')
        rect(x,states_y,panel_w,states_h,canvas,r=16);text(x+20,states_y+31,label+' · 原生填色 / 独立状态合成',19,fg)
        cy=states_y+48;button_x=x+180
        text(x+20,cy+dh/2+5,'普通默认',14,fg);rect(button_x,cy,dw,dh,body,border,radius);text(button_x+dw/2,cy+dh/2+5,'取消',16,fg,'middle')
        cy+=row_gap;text(x+20,cy+sh/2+5,'少量primary',14,fg);rect(button_x,cy,sw,sh,'#e8c66a',r=radius);image(button_x,cy,sw,sh,sample1);text(button_x+sw/2,cy+sh/2+5,'保存设置',16,on_primary,'middle')
        cy+=row_gap;text(x+20,cy+sh/2+5,'强调hover',14,fg);image(button_x,cy,sw,sh,sample1,'filter="url(#hover-glow)"');rect(button_x,cy,sw,sh,body,r=radius);image(button_x,cy,sw,sh,sample1);text(button_x+sw/2,cy+sh/2+5,'继续',16,fg,'middle')
        text(x+20,states_y+states_h-22,'body未参与互反射；ring不烘焙文字或外辉光',14,fg)
        rect(x,zoom_y,panel_w,zoom_h,canvas,r=16);text(x+20,zoom_y+31,'同一ring的2x辅助视图 · 不是额外配灯',17,fg)
        zx=x+(panel_w-sw*2)/2;rect(zx,zoom_y+64,sw*2,sh*2,body,r=radius*2);image(zx,zoom_y+64,sw*2,sh*2,sample2)
    text(32,footer_y,'洁净新精抛是目标，α与实际工艺未测量匹配。半椭圆单调normal消除旧sin²折返，不承诺无合理暗侧。',15,'#bdb6a8')
    text(32,footer_y+36,'物理预览PNG/EXR离线保留；svg目录是真正路径/渐变，颜色近似不冒称精确光谱解。未改运行。',15,'#bdb6a8')
    text(32,footer_y+72,'源包内relative数据/参数/算法可按新尺寸位置重建；静态结果动态变形后仍属于近似。',15,'#bdb6a8')
    nodes.append('</svg>');svg=output/'optical-ring-physical-preview.svg';svg.write_text('\n'.join(nodes))
    svg_to_png(svg,output/'optical-ring-physical-preview.png',board_w,board_h)
