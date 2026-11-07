"""PBR预览合成；含PNG，明确不同于svg目录内纯矢量资源。"""
import base64
from html import escape


def export_ring_board(output,p,svg_to_png):
    def uri(name):return 'data:image/png;base64,'+base64.b64encode((output/name).read_bytes()).decode()
    b=p['board'];g=p['geometry'];controls=p['controls'];sample=next((item for item in controls if item['id']=='medium'),controls[len(controls)//2])
    default=controls[0];sw,sh=sample['width'],sample['height'];dw,dh=default['width'],default['height'];radius=g['corner_radius_mm']*.001/b['metres_per_pixel']
    panel_w=max(b['width']+40,sw+220,sw*2+72);board_w=panel_w*2+96
    top_y=112;top_h=b['height']+78
    zoom_y=top_y+top_h+28;zoom_h=sh*2+112;footer_y=zoom_y+zoom_h+42;board_h=footer_y+44
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
    text(32,46,'金属细边 · 连续柔光',28)
    text(32,80,'原尺寸 88 / 144 / 240 / 376 · 黑金与白金',16,'#bdb6a8')
    for x,canvas,body,fg,border,on_primary,label in [(32,'#101112','#191b1d','#f4f1e8','#555149','#17140d','黑底'),
             (64+panel_w,'#f7f6f2','#ffffff','#1e1c18','#817a6c','#211a08','白底')]:
        rect(x,top_y,panel_w,top_h,canvas,r=16);text(x+20,top_y+31,label,19,fg)
        for item in controls:rect(x+20+item['x'],top_y+52+item['y'],item['width'],item['height'],body,r=radius)
        image(x+20,top_y+52,b['width'],b['height'],layout)
        for item in controls:text(x+20+item['x']+item['width']/2,top_y+52+item['y']+item['height']/2+5,('采用' if item['id']=='compact' else '继续'),16,fg,'middle')
        rect(x,zoom_y,panel_w,zoom_h,canvas,r=16);text(x+20,zoom_y+31,'边缘细节（2倍）',17,fg)
        zx=x+(panel_w-sw*2)/2;rect(zx,zoom_y+64,sw*2,sh*2,body,r=radius*2);image(zx,zoom_y+64,sw*2,sh*2,sample2)
    text(32,footer_y,f'物理效果预览 · 共同柔光屏；金光谱、精抛参数和截面保持。',15,'#bdb6a8')
    nodes.append('</svg>');svg=output/'optical-ring-physical-preview.svg';svg.write_text('\n'.join(nodes))
    svg_to_png(svg,output/'optical-ring-physical-preview.png',board_w,board_h)
