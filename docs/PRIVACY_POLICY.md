# Privacy Policy — Azure DevOps HTML Preview

_Last updated: 2026-11-13_

**Azure DevOps HTML Preview** ("the extension") is a browser extension that renders HTML files stored in Azure DevOps Repos with JavaScript enabled, Markdown files with an alternative layout, PDF files with Chrome's built-in PDF viewer, Excel (.xlsx) workbooks as read-only tables, and Word (.docx) documents and PowerPoint (.pptx) presentations with high-fidelity layout. It also renders HTML and Markdown attachments of Azure Boards work items in the attachment preview dialog.

## Data collection

The extension does **not** collect, store, transmit, sell, or share any personal data or usage data. There is no analytics, telemetry, crash reporting, advertising, or remote server operated by the developer.

## What the extension accesses and why

| Access | Why | Where the data goes |
| --- | --- | --- |
| Pages under `https://dev.azure.com/*` | To add the two preview buttons to the file tab bar and to replace the built-in preview area when you click "完整預覽 (內嵌)". | Nowhere. The page is only modified locally in your browser. |
| The HTML, Markdown, PDF, Excel, Word or PowerPoint file you are currently viewing, plus same-repository files it references by relative path (scripts, stylesheets, images) | When you click a preview button, the extension requests those files from the same Azure DevOps organization's Git Items REST API, using your existing browser session. | The file content is held in memory and rendered locally in a frame (or, for PDFs, in Chrome's built-in PDF viewer). For the full-screen mode of HTML, Markdown, Excel, Word, and PowerPoint, the generated preview document is briefly stored in `chrome.storage.session` (in-memory, cleared when the browser closes) only to pass it to the preview window, and is deleted as soon as the window reads it (or immediately if opening the window fails); PDFs are passed to the preview window as an in-memory blob URL instead. |
| The HTML or Markdown work item attachment you open in Azure Boards' attachment preview dialog | To render the attachment instead of showing its source code, the extension reads the work item's attachment list and then that one attachment from the same Azure DevOps organization's Work Item Tracking REST API, using your existing browser session. | The attachment content is held in memory and rendered in a sandboxed frame inside the dialog. It is never stored. |

The extension never requests any other repository content or attachments, never contacts any domain other than the Azure DevOps origin you are already using, and never writes anything to disk or to synced storage.

## Sandboxing

HTML files and attachments, and the HTML generated from Markdown files and attachments and Excel workbooks, are rendered in frames that use the `sandbox` attribute **without** `allow-same-origin`. Scripts inside the previewed file run with a null origin and cannot read Azure DevOps cookies, local storage, or call Azure DevOps APIs with your credentials.

Word and PowerPoint files are rendered by bundled renderers that run entirely inside the same kind of sandboxed frame; for PowerPoint, external media links inside the presentation are blocked, so previewing a file never contacts any other server.

PDF files are not rendered as HTML at all: the raw bytes are handed to Chrome's built-in PDF viewer (PDFium), which does not execute JavaScript embedded in PDFs. Because the built-in viewer cannot load inside a `sandbox`ed frame, the PDF frame omits the `sandbox` attribute; this is safe precisely because a PDF is never parsed as an HTML document and therefore cannot run scripts of any kind.

## Permissions

- `storage` — only `chrome.storage.session`, used as described above.
- Host access to `https://dev.azure.com/*` — required to inject the buttons and to fetch the file you are viewing.

## Third parties

No data is shared with third parties. The extension does not load any remote scripts or resources of its own; all open-source libraries it uses—for Markdown rendering (`marked`, `DOMPurify`, `highlight.js`, `mermaid`), Excel parsing (`SheetJS`), Word rendering (`JSZip`, `docx-preview`), and PowerPoint rendering (`@aiden0z/pptx-renderer`, including `JSZip`, `ECharts`, and `mtx-decompressor`)—are bundled inside the extension package and run entirely locally in your browser with zero external transmission.

## Changes

If this policy changes, the updated version will be published at the same URL and the "Last updated" date will be revised.

## Contact

Will Huang — https://github.com/doggy8088
