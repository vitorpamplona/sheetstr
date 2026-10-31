# Sheetstr

Nostr-native spreadsheets: a static web app (`index.html`, `main.js`, `js/`, `style.css`), live at
<https://sheetstr.amethyst.social/>.

## Build and test

No build step. Serve the folder (`python3 -m http.server 8000`) and open it in a browser.

## Remotes and pull requests

The repo is on GitHub, `github.com/vitorpamplona/sheetstr`, which holds the canonical `main`, and on
nostr as a NIP-34 repository,
`nostr://npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z/relay.ngit.dev/sheetstr`: a
push to that remote goes to its GRASP git servers and to GitHub. A PR can go out either way: a
GitHub PR (`gh`), or a nostr proposal (`ngit`, a `pr/…` branch, reviewed on
[gitworkshop.dev](https://gitworkshop.dev/npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z/relay.ngit.dev/sheetstr)).
Remote names vary per clone, so identify them by URL. Open a PR only when the human you work for
asks, and before opening, revising or merging one by either path, use the `ngit-pr` skill.
