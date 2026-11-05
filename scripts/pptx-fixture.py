#!/usr/bin/env python3
"""產生最小但完整的 pptx 測試檔（scripts/test-pptx-core.mjs 的固定輸入，也可拿去瀏覽器實測渲染層）。
python-pptx 在 PEP 668 環境裝不進來，所以直接手打最小 OOXML（zipfile）：
16:9 兩張投影片——第 1 張：標題（未指定字色＝吃主題 dk1）、深藍底白字圓角矩形（檔案指定前景／背景）、
PNG 圖片；第 2 張：淺色背景＋表格（表頭指定底色與白字）。含 theme / slideMaster / slideLayout 等必要零件。"""
import sys, zipfile, base64

# 1×1 紅點 PNG
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
)

NS = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

CT = HDR + '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>'''

RELS = HDR + '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="''' + REL_NS + '''/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>'''

PRES = HDR + f'''<p:presentation {NS}>
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>'''

PRES_RELS = HDR + f'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="{REL_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="{REL_NS}/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="{REL_NS}/slide" Target="slides/slide2.xml"/>
<Relationship Id="rId4" Type="{REL_NS}/theme" Target="theme/theme1.xml"/>
</Relationships>'''

THEME = HDR + '''<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture">
<a:themeElements>
<a:clrScheme name="Fixture">
<a:dk1><a:srgbClr val="1F1F1F"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Fixture">
<a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Fixture">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>'''

EMPTY_TREE = ('<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
              '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
              '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>')

MASTER = HDR + f'''<p:sldMaster {NS}>
<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>{EMPTY_TREE}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles>
</p:sldMaster>'''

MASTER_RELS = HDR + f'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="{REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="{REL_NS}/theme" Target="../theme/theme1.xml"/>
</Relationships>'''

LAYOUT = HDR + f'''<p:sldLayout {NS} type="blank"><p:cSld name="Blank"><p:spTree>{EMPTY_TREE}</p:spTree></p:cSld></p:sldLayout>'''

LAYOUT_RELS = HDR + f'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="{REL_NS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>'''


def run(text, extra=''):
    return f'<a:r><a:rPr lang="zh-TW" {extra}/><a:t>{text}</a:t></a:r>'


SLIDE1 = HDR + f'''<p:sld {NS}><p:cSld><p:spTree>{EMPTY_TREE}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="609600" y="457200"/><a:ext cx="10972800" cy="1066800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p>{run('PPTX 預覽測試投影片', 'sz="4000" b="1"')}</a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Callout"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="609600" y="1905000"/><a:ext cx="6096000" cy="2286000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
<a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-TW" sz="2800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>深藍底白字（檔案指定）</a:t></a:r></a:p></p:txBody></p:sp>
<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="7315200" y="1905000"/><a:ext cx="2286000" cy="2286000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>
</p:spTree></p:cSld></p:sld>'''

SLIDE1_RELS = HDR + f'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="{REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="{REL_NS}/image" Target="../media/image1.png"/>
</Relationships>'''


def cell(text, head=False):
    fill = '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>' if head else ''
    color = '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' if head else ''
    bold = ' b="1"' if head else ''
    rpr = f'<a:rPr lang="zh-TW" sz="1800"{bold}>{color}</a:rPr>'
    return f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>{rpr}<a:t>{text}</a:t></a:r></a:p></a:txBody><a:tcPr>{fill}</a:tcPr></a:tc>'


ROWS = [('項目', '說明'), ('PDF', 'Chrome 內建檢視器'), ('PowerPoint', '高保真投影片')]
TABLE = ''.join(
    f'<a:tr h="508000">{cell(a, i == 0)}{cell(b, i == 0)}</a:tr>' for i, (a, b) in enumerate(ROWS))

SLIDE2 = HDR + f'''<p:sld {NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>{EMPTY_TREE}
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="1219200" y="1219200"/><a:ext cx="9753600" cy="1524000"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/>
<a:tblGrid><a:gridCol w="3048000"/><a:gridCol w="6705600"/></a:tblGrid>{TABLE}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld></p:sld>'''

SLIDE2_RELS = HDR + f'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="{REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>'''

out = sys.argv[1] if len(sys.argv) > 1 else 'fixture.pptx'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CT)
    z.writestr('_rels/.rels', RELS)
    z.writestr('ppt/presentation.xml', PRES)
    z.writestr('ppt/_rels/presentation.xml.rels', PRES_RELS)
    z.writestr('ppt/theme/theme1.xml', THEME)
    z.writestr('ppt/slideMasters/slideMaster1.xml', MASTER)
    z.writestr('ppt/slideMasters/_rels/slideMaster1.xml.rels', MASTER_RELS)
    z.writestr('ppt/slideLayouts/slideLayout1.xml', LAYOUT)
    z.writestr('ppt/slideLayouts/_rels/slideLayout1.xml.rels', LAYOUT_RELS)
    z.writestr('ppt/slides/slide1.xml', SLIDE1)
    z.writestr('ppt/slides/_rels/slide1.xml.rels', SLIDE1_RELS)
    z.writestr('ppt/slides/slide2.xml', SLIDE2)
    z.writestr('ppt/slides/_rels/slide2.xml.rels', SLIDE2_RELS)
    z.writestr('ppt/media/image1.png', PNG)
print(out)
