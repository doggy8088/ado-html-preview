#!/usr/bin/env python3
"""產生含完整格式的 xlsx 測試檔（scripts/test-xlsx-core.mjs 的固定輸入）。
涵蓋：粗體／斜體／字色／底色／對齊／自動換行、數字格式（日期、百分比、千分位）、
合併儲存格、欄寬、列高、凍結窗格（B2）、兩個工作表、內嵌字串跳脫字元、
以及「淺色底＋未指定字色」的格子（視覺驗證的對比檢查要盯的目標）。"""
import re
import sys
import zipfile
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Color

wb = Workbook()
ws = wb.active
ws.title = "程式表"

blue = PatternFill("solid", fgColor="4472C4")
yellow = PatternFill("solid", fgColor="FFF2CC")

ws.merge_cells("A1:D1")
ws["A1"] = "ERP 外掛程式改善初步上線程式表"
ws["A1"].font = Font(bold=True, color="FFFFFF", size=13)
ws["A1"].fill = blue
ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
ws.row_dimensions[1].height = 26  # pt

for col, title in zip("ABCD", ["程式代號", "說明", "上線日", "完成度"]):
    c = ws[f"{col}2"]
    c.value = title
    c.font = Font(bold=True, color="FFFFFF")
    c.fill = blue
    c.alignment = Alignment(horizontal="center", vertical="center")

ws["A3"] = "結論"
ws["A3"].font = Font(bold=True)
ws["B3"] = "多行說明：儲存格自動換行測試，字數刻意拉長以便觀察斷行與列高行為。"
ws["B3"].alignment = Alignment(wrapText=True, vertical="top")
ws["C3"] = date(2023, 11, 20)
ws["C3"].number_format = "yyyy/m/d"
ws["C3"].alignment = Alignment(horizontal="center")
ws["D3"] = 0.85
ws["D3"].number_format = "0%"

ws["A4"] = "程式代號"
ws["B4"] = "內嵌字串測試 & <esc>"
ws["C4"] = date(2024, 1, 8)
ws["C4"].number_format = "yyyy/m/d"
ws["C4"].alignment = Alignment(horizontal="center")
ws["D4"] = 0.5
ws["D4"].number_format = "0%"

# B5：淺色底（黃）＋未指定字色＋斜體＋自動換行 —— 深色模式下若字色跟主題會不可讀，對比斷言要抓的案例
ws["A5"] = "預算"
ws["B5"] = 1234567.891
ws["B5"].number_format = "#,##0.00"
ws["B5"].font = Font(italic=True)
ws["B5"].fill = yellow
ws["B5"].alignment = Alignment(horizontal="right", wrapText=True)
ws["C5"] = True
ws["D5"] = "#N/A"

ws.column_dimensions["A"].width = 14
ws.column_dimensions["B"].width = 42
ws.column_dimensions["C"].width = 12
ws.column_dimensions["D"].width = 12
ws.row_dimensions[3].height = 40
ws.freeze_panes = "B2"

ws2 = wb.create_sheet("Notes & 附註")
ws2["A1"] = "Notes"
ws2["A2"] = 42

# 第三張「邊界」：可見範圍不從 A1 開始（C3:F8）、凍結窗格要換算 r0 / c0、indexed 色（SheetJS 會掉前導零）、
# indexed 填色（SheetJS 會整個丟掉）、有樣式的空白格（t: 'z'）、凍結區內的空白格（有樣式 / 無樣式）
ws3 = wb.create_sheet("邊界")
black = PatternFill("solid", fgColor=Color(indexed=8))
navy = PatternFill("solid", fgColor=Color(indexed=18))
ws3["C3"] = "紅字黑底"          # indexed 10 = FF0000（SheetJS rgb 'ff00' → CSS 會讀成透明的 #RGBA）
ws3["C3"].font = Font(color=Color(indexed=10))
ws3["C3"].fill = black
ws3["D3"].fill = yellow         # 凍結列內、有樣式的空白格
ws3["E3"] = "綠字黑底"          # indexed 11 = 00FF00（SheetJS 'ff00' 以外的另一種錯位 '0ff0'）
ws3["E3"].font = Font(color=Color(indexed=11))
ws3["E3"].fill = black
ws3["F3"] = "黃字深藍底"        # indexed 13 = FFFF00（SheetJS 'ffff0'，無效的 5 位 hex）
ws3["F3"].font = Font(color=Color(indexed=13))
ws3["F3"].fill = navy
# C4：凍結區內、完全沒有樣式的空白格（只靠表格層預設底色保持不透明）
ws3["D4"] = "藍字"              # indexed 12 = 0000FF
ws3["D4"].font = Font(color=Color(indexed=12))
ws3["E6"].fill = blue           # 一般區、有樣式的空白格
ws3["F8"] = "end"
ws3.freeze_panes = "D5"         # 工作表座標：4 列 3 欄；可見區從 C3 起 → 2 列 1 欄

out = sys.argv[1]
wb.save(out)

# 內部檔名與頁籤順序錯開（實務上移動 / 刪除過工作表的檔案常見）：
# 程式表 → sheet3.xml、Notes → sheet1.xml、邊界 → sheet2.xml，workbook.xml.rels 改用相對路徑 Target
rename = {"xl/worksheets/sheet1.xml": "xl/worksheets/sheet3.xml",
          "xl/worksheets/sheet2.xml": "xl/worksheets/sheet1.xml",
          "xl/worksheets/sheet3.xml": "xl/worksheets/sheet2.xml"}
with zipfile.ZipFile(out) as z:
    entries = [(i.filename, z.read(i.filename)) for i in z.infolist()]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in entries:
        if name == "xl/_rels/workbook.xml.rels":
            text = data.decode("utf-8")
            text = re.sub(r'Target="/?(?:xl/)?(worksheets/sheet\d+\.xml)"',
                          lambda m: 'Target="' + rename["xl/" + m.group(1)][3:] + '"', text)
            data = text.encode("utf-8")
        z.writestr(rename.get(name, name), data)
print("wrote", out)
