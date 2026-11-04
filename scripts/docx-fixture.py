#!/usr/bin/env python3
"""產生含完整格式的 docx 測試檔（scripts/test-docx-core.mjs 的固定輸入）。
python-docx 在 PEP 668 環境裝不進來，所以直接手打最小 OOXML（zipfile）：
標題、粗體／字色、底色表格（含「淺色底＋未指定字色」格——對比檢查要盯的案例）、
置中對齊、圖片（驗證 useBase64URL 序列化）、A4 頁面。"""
import sys, zipfile, base64

# 1×1 紅點 PNG
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
)

CT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''

DOC_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>'''

STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:eastAsia="微軟正黑體" w:hAnsi="Calibri"/><w:sz w:val="22"/>
</w:rPr></w:rPrDefault></w:docDefaults>
</w:styles>'''

def p(runs, props=""):
    return f'<w:p><w:pPr>{props}</w:pPr>{runs}</w:p>'

def r(text, rpr=""):
    return f'<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'

# 內容：標題（粗體 16pt 深藍 #1F3864）、內文、底色表格、置中段落、圖片
title = p(r("ERP 外掛程式建置專案－需求建議書(RFP)", '<w:b/><w:sz w:val="32"/><w:color w:val="1F3864"/>'),
          '<w:jc w:val="center"/>')
intro = p(r("第一段內文：") + r("粗體強調文字", '<w:b/>') + r("，以及預設字色的一般文字。"))

# 表格：表頭深藍底白字；資料列米黃底（FFF2CC）＋未指定字色（紙張語意要給檔案 dk1）
def tc(shd, text_runs, w=4000):
    return (f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>'
            + (f'<w:shd w:val="clear" w:color="auto" w:fill="{shd}"/>' if shd else '')
            + f'</w:tcPr>{p(text_runs)}</w:tc>')
rows = (
    '<w:tr>' + tc("1F3864", r("項目", '<w:b/><w:color w:val="FFFFFF"/>')) + tc("1F3864", r("說明", '<w:b/><w:color w:val="FFFFFF"/>')) + '</w:tr>'
    '<w:tr>' + tc("FFF2CC", r("帳號開通")) + tc("FFF2CC", r("時程：兩週")) + '</w:tr>'
    '<w:tr>' + tc(None, r("教育訓練")) + tc(None, r("時程：一週")) + '</w:tr>'
)
table = ('<w:tbl><w:tblPr><w:tblBorders>'
         + ''.join(f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>' for s in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
         + '</w:tblBorders></w:tblPr>' + rows + '</w:tbl>')

center_p = p(r("置中對齊的段落", '<w:i/>'), '<w:jc w:val="center"/>')
img_p = ('<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
         'distT="0" distB="0" distL="0" distR="0"><wp:extent cx="9525" cy="9525"/>'
         '<wp:docPr id="1" name="dot"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
         '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
         '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
         '<pic:nvPicPr><pic:cNvPr id="1" name="dot"/><pic:cNvPicPr/></pic:nvPicPr>'
         '<pic:blipFill><a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>'
         '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
         '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm>'
         '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
         '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')

DOC = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
{title}
{intro}
{table}
{center_p}
{img_p}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body>
</w:document>'''

with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CT)
    z.writestr('_rels/.rels', RELS)
    z.writestr('word/_rels/document.xml.rels', DOC_RELS)
    z.writestr('word/styles.xml', STYLES)
    z.writestr('word/document.xml', DOC)
    z.writestr('word/media/image1.png', PNG)
print('wrote', sys.argv[1])
