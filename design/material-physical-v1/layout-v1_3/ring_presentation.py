"""将同一透明ring原像素合成到原生body；辉光独立，不改变物理素材。"""
import base64
from html import escape


def export_ring_board(output,p,svg_to_png):
    def uri(name):return 'data:image/png;base64,'+base64.b64encode((output/name).read_bytes()).decode()
    layout=uri('layout-1x.png');medium=uri('medium-ring-1x.png');medium2x=uri('medium-ring-2x.png')
    nodes=['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">',
           '<style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif}</style>',
           '<defs><filter id="hover-glow" x="-20%" y="-100%" width="140%" height="300%"><feFlood flood-color="#e8c66a" flood-opacity=".42"/><feComposite in2="SourceAlpha" operator="in"/><feGaussianBlur stdDeviation="3.5"/></filter></defs>',
           '<rect width="1200" height="1200" fill="#17191b"/>']
    def text(x,y,value,size=16,color='#f4f1e8',anchor='start'):
        nodes.append(f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" fill="{color}">{escape(value)}</text>')
    def rect(x,y,width,height,fill,stroke=None,radius=8):
        extra='' if stroke is None else f' stroke="{stroke}"'
        nodes.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" fill="{fill}"{extra}/>')
    def image(x,y,width,height,data,extra=''):
        nodes.append(f'<image x="{x}" y="{y}" width="{width}" height="{height}" href="{data}" {extra}/>')
    text(32,46,'Au-JC1972 · 通宽微曲面金属边环',28)
    text(32,80,'边宽2CSSpx / 跨宽峰高.08mm / 中央透明 · 一个共同光场，原生body与状态另行合成',16,'#bdb6a8')
    themes=[(32,'#101112','#191b1d','#f4f1e8','#555149','#17140d','黑底'),
            (616,'#f7f6f2','#ffffff','#1e1c18','#817a6c','#211a08','白底')]
    for x,canvas,body,fg,border,on_primary,label in themes:
        rect(x,112,552,334,canvas,radius=16)
        text(x+20,143,label+' · 显式强调中性body + 同一物理ring',19,fg)
        for item in p['controls']:
            rect(x+20+item['x'],164+item['y'],item['width'],item['height'],body)
        image(x+20,164,512,256,layout)
        for item in p['controls']:
            text(x+20+item['x']+item['width']/2,164+item['y']+27,'继续',16,fg,'middle')
        rect(x,474,552,346,canvas,radius=16)
        text(x+20,505,label+' · 同一240环的原生填色/状态示意',19,fg)
        text(x+20,549,'普通默认',14,fg)
        rect(x+180,522,144,44,body,border)
        text(x+252,549,'取消',16,fg,'middle')
        text(x+20,631,'少量primary',14,fg)
        rect(x+180,604,240,44,'#e8c66a')
        image(x+180,604,240,44,medium)
        text(x+300,631,'保存设置',16,on_primary,'middle')
        text(x+20,713,'强调hover',14,fg)
        image(x+180,686,240,44,medium,'filter="url(#hover-glow)"')
        rect(x+180,686,240,44,body)
        image(x+180,686,240,44,medium)
        text(x+300,713,'继续',16,fg,'middle')
        text(x+20,780,'外辉光为独立状态效果，ring本身不发光',14,fg)
        rect(x,848,552,200,canvas,radius=16)
        text(x+20,879,'240×44环的2x辅助视图 · 原生body在下层',17,fg)
        rect(x+36,912,480,88,body,radius=16)
        image(x+36,912,480,88,medium2x)
    text(32,1090,'JC实测谱 + roughconductor无diffuse/RGB染色；α=.006是工程选择，实际加工表面并未测量匹配。',15,'#bdb6a8')
    text(32,1126,'原生body仅合成，未参与环的互反射；仅参考布局成立，运行若采用只消费静态资源。',15,'#bdb6a8')
    text(32,1162,'候选边框稿，未覆盖运行/生产CSS；PNG中央不建金属面，文字/焦点/热区由原生组件负责。',15,'#bdb6a8')
    nodes.append('</svg>');svg=output/'optical-ring-study.svg';svg.write_text('\n'.join(nodes))
    svg_to_png(svg,output/'optical-ring-study.png',1200,1200)
