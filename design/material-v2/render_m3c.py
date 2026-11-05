"""M3c代码原生应用样图：只嵌入完整原PNG，不编辑任何PNG像素。"""
from pathlib import Path
from html import escape
import render_material as m

ROOT=Path(__file__).resolve().parent
WRAPPER=(ROOT/'gold-surface.svg').read_text()
INNER=WRAPPER.partition('>')[2].rsplit('</svg>',1)[0]


def main():
    a=['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1080" viewBox="0 0 1200 1080">',
       '<style>text{font-family:"Noto Sans CJK SC","Microsoft YaHei UI",sans-serif}</style>',
       '<defs><linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0C0"/><stop offset=".44" stop-color="#D2B36B"/><stop offset=".72" stop-color="#866120"/><stop offset="1" stop-color="#D5B978"/></linearGradient><filter id="edgeGlow" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>',
       '<rect width="1200" height="1080" fill="#17191b"/>',
       '<defs><symbol id="goldSurface" viewBox="296.18 217.2 1579.64 289.6" preserveAspectRatio="xMidYMid slice" overflow="hidden">'+INNER+'</symbol></defs>']
    serial=0
    def text(x,y,s,size=16,color='#f4f1e8',anchor='start'):
        a.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}">{escape(s)}</text>')
    def button(x,y,w,label,face,primary=False,hover=False):
        nonlocal serial
        serial+=1;ident='button'+str(serial)
        a.append(f'<defs><clipPath id="{ident}"><rect x="{x}" y="{y}" width="{w}" height="44" rx="8"/></clipPath></defs>')
        if hover:
            a.append(f'<rect x="{x}" y="{y}" width="{w}" height="44" rx="8" fill="none" stroke="#E8C66A" stroke-width="2" opacity=".42" filter="url(#edgeGlow)"/>')
        a.append(f'<g clip-path="url(#{ident})">')
        if primary or hover:
            a.append(f'<use href="#goldSurface" x="{x}" y="{y}" width="{w}" height="44"/>')
        else:
            a.append(f'<rect x="{x}" y="{y}" width="{w}" height="44" rx="8" fill="{face}"/>')
        if not primary and hover:
            raised='#222527' if face=='#191B1D' else '#F1EEE6'
            a.append(f'<rect x="{x+1.5}" y="{y+1.5}" width="{w-3}" height="41" rx="6.5" fill="{raised}"/>')
        a.append('</g>')
        if primary:
            a.append(f'<rect x="{x+.5}" y="{y+.5}" width="{w-1}" height="43" rx="7.5" fill="none" stroke="#94702D" stroke-width="1"/>')
        elif not hover:
            border='#555149' if face=='#191B1D' else '#817A6C'
            a.append(f'<rect x="{x+.75}" y="{y+.75}" width="{w-1.5}" height="42.5" rx="7.25" fill="none" stroke="{border}" stroke-width="1.5"/>')
        if primary or hover:
            a.append(f'<rect x="{x+1}" y="{y+1}" width="{w-2}" height="42" rx="7" fill="none" stroke="url(#edge)" stroke-width=".6"/>')
        color='#17140D' if primary else ('#F4F1E8' if face=='#191B1D' else '#1E1C18')
        text(x+w/2,y+28,label,16,color,'middle')

    text(32,48,'M3c · 金属内部表面 × 原生控件几何',28)
    text(32,82,'共享材质2.0 · 固定安全内部viewBox + cover；轮廓/热区/文字由代码定义',16,'#bdb6a8')
    for x,bg,fg,face,title in [(32,'#101112','#F4F1E8','#191B1D','黑底上下文'),(616,'#F7F6F2','#1E1C18','#FFFFFF','白底上下文')]:
        a.append(f'<rect x="{x}" y="112" width="552" height="760" rx="16" fill="{bg}"/>')
        text(x+24,152,title,20,fg)
        text(x+32,199,'普通默认 · 中性面与中性边界 / 240×44',14,fg)
        button(x+156,219,240,'取消',face)
        text(x+32,307,'主操作 · 内部金属表面 / 240×44',14,fg)
        button(x+156,327,240,'保存设置',face,True)
        text(x+32,417,'较短控件 · 同一等比表面映射 / 144×44',14,fg)
        button(x+96,437,144,'返回',face)
        button(x+312,437,144,'应用',face,True)
        text(x+32,527,'动态宽主操作 · 安全内部继续裁切 / 376×44',14,fg)
        button(x+88,547,376,'编辑布局',face,True)
        text(x+32,627,'Hover · 普通操作细金边 / 主操作独立外辉光',14,fg)
        button(x+80,657,144,'返回',face,False,True)
        button(x+264,657,240,'保存设置',face,True,True)
        text(x+24,764,'普通默认保持中性；仅强调/hover用细金边',14,fg)
        text(x+24,800,'44px热区 / radius8 / 原生边界 / 深色主按钮文字',14,fg)
        text(x+24,836,'不消费原包边/毛刺，不对卡片与整窗铺金',14,fg)
    text(32,920,'安全内部viewBox：296.18 / 217.2 / 1579.64 / 289.6 · 自包含SVG，完整PNG原样内嵌',15,'#bdb6a8')
    text(32,956,'144/240采样关系保持；376按宽cover，原图y只取269.57–454.43，不露原图外缘。',15,'#bdb6a8')
    text(32,992,'共同定义已先行：materials2.0；裁切/边宽/模糊是工程选择，生成纹理不是数值物理模型。',15,'#bdb6a8')
    text(32,1030,'应用设计已独立批准；运行接入另记 · M3C-APPLICATION.md / gold-surface.svg / render_m3c.py · 非运行截图',14,'#bdb6a8')
    a.append('</svg>')
    target=ROOT/'m3c-application.svg';target.write_text('\n'.join(a))
    m.png(target,ROOT/'m3c-application.png',1200,1080)
    print('m3c-application.svg + m3c-application.png 已生成')


if __name__=='__main__':main()
