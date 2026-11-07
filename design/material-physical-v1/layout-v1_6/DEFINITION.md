# Au-JC1972：共同有限柔光屏 v1.6

root与ux_review批准本唯一方案后保存本定义与真输入，再生成同场景四宽物理图；保留v1.5。公司materials与运行不改，实际采用新增内容及完整状态随后按真实图决定，不因一稿有效自动停点。

## 差距与机制

v1.5已把灯外近黑抬为暖棕，但宽暗段仍影响洁净精抛金边。原矩形灯为1、外侧环境.16，近镜面曲面将几何硬边映成急剧亮暗切换；不再全局提高floor，也不改Au/α/曝光掩盖。改用同一更大的有限摄影棚屏：有限亮核→宽柔光肩→外缘平滑接原环境，沿真实曲面反射方向采样，不给金属表面画条纹。

## 坐标和真实光场

世界+Z向相机，原共同倾斜/相机/三个控件位置保持。软屏center=(-.020,.072,.25)m，size=(.90,.80)m，T=translate@Rz(-45°)@Rx180@scale(.45,.40,1)，朝-Z。s沿(1,-1,0)/sqrt2，t沿(1,1,0)/sqrt2；native UV的s=.90(u-.5)，t=-.80(v-.5)。缓存行号就是v，不额外翻转。

W(x;a,b)在|x|≤a时为1、|x|≥b为0，过渡q=(|x|-a)/(b-a)，取1-(3q²-2q³)。

B=W(s;.30,.45)W(t;.24,.40)

K=W(s;.16,.30)W(t;.025,.10)

S=.16+.34B+.50K

S非负、有界≤1，宽肩约.50，亮核峰值1，边缘与D65环境.16同谱同幅。发光板用reflectance0的黑吸收BSDF，只定义发射，不引入未说明的灯板反射；这不改Au或给金属加diffuse。

V=(0,0,1)，N按共同变换逆转置归一，R=2(N·V)N-V；仅Rz>0时与z=.25求交，Q=P+(.25-Pz)/Rz*R，投影到s/t取S。原三控件正面中心Q的s约-.067/-.022/+.029、t约-.013/-.023/-.026m，在亮核内/近核。半椭圆中间80%宽的局部法线偏角约≤12.1°，加原8°倾斜后，当前布局反射落点位移保守量级约.22m，在本屏范围内。近边/近水平/背向反射仍由环境底承担，不说前方一板覆盖全部normal或暗侧必消。

## 材料、能量与实现

JC Au数据、许可/provenance、GGX α=.006、specular_reflectance1、半椭圆边宽1mm/峰高.08mm、0EV、1024spp、seed20261103、8线程保持；精抛为目标而非实测工艺匹配。主操作内面用原生语义金填色，物理材质仅闭合环；普通默认中性，hover/persistent edge按明确定义采用，辉光独立。body仅合成，不参与互反射。

S作为灰标量直接乘D65，不用RGB光谱重建；原BRDF/PDF和线性显示流程保持。新屏更大意味着允许更多总发射量，不声称与旧屏等功率：连续积分∫S dA=.30715m²系数，Lambertian发射Φλ=π*D65λ*该积分，约旧.104652m² uniform1屏的2.94倍。这是屏发射量比较，不是像素对比、实测亮度或曝光增益。

light_field.py按解析定义生成512×512×1 float32 raw线性EXR；bilinear/clamp，边缘texel钉.16，属于离线离散近似。radiance为d65(scale1)嵌套单通道bitmap(raw true)，保留真实D65谱。Mitsuba3.9.1的bitmap提供eval/sample_spectrum/sample_position/pdf，area沿原生纹理重要性采样；该版本不传sample_texture选项，不写新Emitter/Texture插件。缓存约1MiB未压缩，只离线保留。

依据：Mitsuba3.9.1官方源码 https://raw.githubusercontent.com/mitsuba-renderer/mitsuba3/v3.9.1/src/spectra/d65.cpp 、https://raw.githubusercontent.com/mitsuba-renderer/mitsuba3/v3.9.1/src/textures/bitmap.cpp 、https://raw.githubusercontent.com/mitsuba-renderer/mitsuba3/v3.9.1/src/emitters/area.cpp 。源与params、原Au快照均包内相对路径，不联网。

## 实际尺寸、资源与后续判断

保留144/240/376×44原位置，另在同板x240/y32加入88×44“采用”，不改控件几何迎合cache、不加第二次积分。源支持真实W/H/边宽/R/位置重生成，四份cache不代表所有流动尺寸。几何/原生SVG为可编辑源，工程SVG渐变不冒称PBR光谱解；运行如采用只选必要小缓存或明确9slice近似，动态搬移/拉伸不称精确共同光场。旧AI位图不作为本新源，主面没有另起物理模型。

完整portable源/data、解析发光算法、真JSON、实际mesh/sourceSHA、EXR和四宽1x/2x透明环保留。运行不携EXR/renderer，不逐帧求光；实际资源成本生成后记录。物理图形成后继续按澄澈、洁净、反射连贯和真实消费尺寸判断能否采用；仍有问题就据反射覆盖/采样/合成分析继续，不自动把阶段图当停止点。完整交互状态与正式共享2.3/CSS须在可采用范围明确后补齐，不由本研究直接改运行。
