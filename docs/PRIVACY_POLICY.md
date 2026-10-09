# Privacy Policy — Azure DevOps HTML Preview

_Last updated: 2026-10-09_

**Azure DevOps HTML Preview** ("the extension") is a browser extension that renders HTML files stored in Azure DevOps Repos with JavaScript enabled, and Markdown files with an alternative layout, inside an isolated sandbox.

## Data collection

The extension does **not** collect, store, transmit, sell, or share any personal data or usage data. There is no analytics, telemetry, crash reporting, advertising, or remote server operated by the developer.

## What the extension accesses and why

| Access | Why | Where the data goes |
| --- | --- | --- |
| Pages under `https://dev.azure.com/*` | To add the two preview buttons to the file tab bar and to replace the built-in preview area when you click "完整預覽 (內嵌)". | Nowhere. The page is only modified locally in your browser. |
| The HTML or Markdown file you are currently viewing, plus same-repository files it references by relative path (scripts, stylesheets, images) | When you click a preview button, the extension requests those files from the same Azure DevOps organization's Git Items REST API, using your existing browser session. | The file content is held in memory and rendered in a sandboxed frame. For the full-screen mode it is briefly stored in `chrome.storage.session` (in-memory, cleared when the browser closes) only to pass it to the preview window, and is deleted as soon as the window reads it. |

The extension never requests any other repository content, never contacts any domain other than the Azure DevOps origin you are already using, and never writes anything to disk or to synced storage.

## Sandboxing

HTML files, and the HTML generated from Markdown files, are rendered in frames that use the `sandbox` attribute **without** `allow-same-origin`. Scripts inside the previewed file run with a null origin and cannot read Azure DevOps cookies, local storage, or call Azure DevOps APIs with your credentials.

## Permissions

- `storage` — only `chrome.storage.session`, used as described above.
- Host access to `https://dev.azure.com/*` — required to inject the buttons and to fetch the file you are viewing.

## Third parties

No data is shared with third parties. The extension does not load any remote scripts or resources of its own; the open-source libraries it uses for Markdown rendering (marked, DOMPurify, highlight.js, mermaid) are bundled inside the extension package.

## Changes

If this policy changes, the updated version will be published at the same URL and the "Last updated" date will be revised.

## Contact

Will Huang — https://github.com/doggy8088
