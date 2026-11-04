#!/usr/bin/env python3
"""產生含完整格式的 xlsx 測試檔（scripts/test-xlsx-core.mjs 的固定輸入）。
涵蓋：粗體／斜體／字色／底色／對齊／自動換行、數字格式（日期、百分比、千分位）、
合併儲存格、欄寬、列高、凍結窗格（B2）、兩個工作表、內嵌字串跳脫字元、
以及「淺色底＋未指定字色」的格子（視覺驗證的對比檢查要盯的目標）。"""
import sys
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

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

ws2 = wb.create_sheet("Notes")
ws2["A1"] = "Notes"
ws2["A2"] = 42

wb.save(sys.argv[1])
print("wrote", sys.argv[1])
