"""纯stdlib可参数化SVG几何/截面；工程渐变不是光谱PBR解。"""
from pathlib import Path
from html import escape
import argparse
import json

ROOT=Path(__file__).resolve().parent


def rounded_path(x,y,w,h,r):
    return (f'M{x+r:g},{y:g} H{x+w-r:g} A{r:g},{r:g} 0 0 1 {x+w:g},{y+r:g} '
            f'V{y+h-r:g} A{r:g},{r:g} 0 0 1 {x+w-r:g},{y+h:g} '
            f'H{x+r:g} A{r:g},{r:g} 0 0 1 {x:g},{y+h-r:g} '
            f'V{y+r:g} A{r:g},{r:g} 0 0 1 {x+r:g},{y:g} Z')


def generate(p,output):
    output.mkdir(parents=True,exist_ok=True)
    g=p['geometry'];mpp=p['board']['metres_per_pixel'];r=g['corner_radius_mm']*.001/mpp;edge=g['edge_width_mm']*.001/mpp
    colors=p['vector_preview']['gradient_colors']
    outputs=[]
    for item in p['controls']:
        w,h=item['width'],item['height']
        if not (0<edge<r and 2*r<=min(w,h)):raise ValueError('SVG几何要求0<边宽<圆角半径且圆角适合宽高')
        path=rounded_path(0,0,w,h,r)+' '+rounded_path(edge,edge,w-2*edge,h-2*edge,r-edge)
        identity='gold-preview-'+item['id']
        metadata={'role':'pure vector geometry plus engineering gradient, not spectral rendering',
                  'width_css':w,'height_css':h,'radius_css':r,'edge_css':edge,'color_mapping':p['vector_preview']['gradient_mapping']}
        svg=(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
             '<title>可参数化单凸金属环：SVG几何与工程渐变近似</title>\n'
             '<desc>中央为evenodd孔；颜色来自公司令牌与工程边界，不是JC光谱计算或PBR预览的矢量复刻。改变尺寸应重新运行算法以保留边宽和圆角。</desc>\n'
             f'<metadata>{escape(json.dumps(metadata,ensure_ascii=False))}</metadata>\n'
             f'<defs><linearGradient id="{identity}" x1="0" y1="1" x2="1" y2="0">'
             f'<stop offset="0" stop-color="{colors[0]}"/><stop offset=".48" stop-color="{colors[1]}"/><stop offset="1" stop-color="{colors[2]}"/>'
             '</linearGradient></defs>\n'
             f'<path d="{path}" fill="url(#{identity})" fill-rule="evenodd"/>\n</svg>\n')
        target=output/(item['id']+'-ring.svg');target.write_text(svg);outputs.append(target.name)
    # A指令保留精确椭圆弧；x/z同比例绘制，显示比例来自w而非拟合光照。
    width_mm=g['edge_width_mm'];peak_mm=g['edge_crown_height_mm'];bottom_mm=g['edge_bottom_z_mm']
    scale=480/width_mm;base_y=150;top_y=base_y-peak_mm*scale;bottom_y=base_y-bottom_mm*scale
    rx=240;ry=peak_mm*scale
    section=(f'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300">\n'
             '<title>真实单凸半椭圆截面定义</title><desc>椭圆弧和薄壁尺寸是几何定义；填充渐变仅示意体积，不是光谱照明。</desc>\n'
             '<defs><linearGradient id="section-preview" x1="0" y1="0" x2="0" y2="1">'
             f'<stop offset="0" stop-color="{colors[2]}"/><stop offset="1" stop-color="{colors[0]}"/></linearGradient></defs>\n'
             '<rect width="640" height="300" fill="#191B1D"/>\n'
             f'<path d="M80,{base_y:g} A{rx:g},{ry:g} 0 0 1 560,{base_y:g} V{bottom_y:g} H80 Z" fill="url(#section-preview)"/>\n'
             f'<path d="M80,{base_y:g} H560 M320,{base_y:g} V{top_y:g}" fill="none" stroke="#B7B0A3" stroke-dasharray="4 4"/>\n'
             '<g fill="#F4F1E8" font-family="sans-serif" font-size="14">'
             '<text x="32" y="30">半椭圆真实截面：几何精确，渐变为工程示意</text>'
             f'<text x="32" y="62">w={width_mm:g}mm / H={peak_mm:g}mm / bottom={bottom_mm:g}mm</text>'
             '<text x="32" y="245">d=(w/2)(1−cos t), z=H sin t, 0≤t≤π</text>'
             '<text x="32" y="273">normal从外壁经顶部单调转向内壁；无中心金属面</text></g>\n</svg>\n')
    (output/'ring-section.svg').write_text(section);outputs.append('ring-section.svg')
    generate_theme_board(p,output);outputs.append('vector-theme-board.svg')
    return outputs


def generate_theme_board(p,output):
    b=p['board'];g=p['geometry'];mpp=b['metres_per_pixel'];radius=g['corner_radius_mm']*.001/mpp;edge=g['edge_width_mm']*.001/mpp
    panel_w=b['width']+40;panel_h=b['height']+78;width=panel_w*2+96;height=panel_h+186
    colors=p['vector_preview']['gradient_colors'];defs=[]
    for item in p['controls']:
        w,h=item['width'],item['height'];path=rounded_path(0,0,w,h,radius)+' '+rounded_path(edge,edge,w-edge*2,h-edge*2,radius-edge)
        defs.append(f'<path id="ring-{item["id"]}" d="{path}" fill-rule="evenodd"/>')
    nodes=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
           '<title>金属细边：黑金与白金，SVG工程近似</title>',
           '<desc>真正路径与渐变，无位图；环境变动属于另附PBR场景，本板不代替物理效果预览。</desc>',
           '<style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif}</style>',
           '<defs>'+''.join(defs)+'<linearGradient id="board-gold" x1="0" y1="1" x2="1" y2="0">'
           f'<stop offset="0" stop-color="{colors[0]}"/><stop offset=".48" stop-color="{colors[1]}"/><stop offset="1" stop-color="{colors[2]}"/>'
           '</linearGradient></defs>',f'<rect width="{width}" height="{height}" fill="#17191B"/>']
    def text(x,y,value,size=16,color='#f4f1e8',anchor='start'):
        nodes.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}">{escape(value)}</text>')
    text(32,46,'金属细边 · 黑金与白金',28)
    text(32,80,'SVG工程近似 · 原尺寸三种宽度',16,'#bdb6a8')
    for x,canvas,body,fg,label in [(32,'#101112','#191B1D','#F4F1E8','黑金'),(64+panel_w,'#F7F6F2','#FFFFFF','#1E1C18','白金')]:
        nodes.append(f'<rect x="{x}" y="112" width="{panel_w}" height="{panel_h}" rx="16" fill="{canvas}"/>')
        text(x+20,143,label,20,fg)
        for item in p['controls']:
            bx=x+20+item['x'];by=164+item['y'];w,h=item['width'],item['height']
            nodes.append(f'<rect x="{bx}" y="{by}" width="{w}" height="{h}" rx="{radius:g}" fill="{body}"/>')
            nodes.append(f'<use href="#ring-{item["id"]}" transform="translate({bx},{by})" fill="url(#board-gold)"/>')
            text(bx+w/2,by+h/2+5,'继续',16,fg,'middle')
    text(32,height-28,f'PBR环境：0.02 → {p["lighting"]["environment_scale"]:g}；本板为路径与渐变近似，物理效果另看PBR预览。',14,'#bdb6a8')
    nodes.append('</svg>');(output/'vector-theme-board.svg').write_text('\n'.join(nodes)+'\n')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--params',type=Path,default=ROOT/'params.json');parser.add_argument('--output-root',type=Path,default=ROOT/'svg')
    args=parser.parse_args();p=json.loads(args.params.read_text());names=generate(p,args.output_root)
    print('已保存纯SVG路径/渐变/截面资源：'+', '.join(names),flush=True)


if __name__=='__main__':main()
