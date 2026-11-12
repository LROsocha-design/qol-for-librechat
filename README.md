# QoL for LibreChat

A browser extension that adds quality-of-life tools to
[LibreChat](https://github.com/danny-avila/LibreChat): a branch tree,
bookmarks that work across branches, Alt+Click editing, a theme editor,
always-on skills ("styles"), a prefill for the message box, and more.

It is unofficial and not affiliated with the LibreChat project. It is free,
under the MIT license.

## What it adds

**Finding your way in a branched chat**

- **Branch tree** (Alt+T): the whole conversation as a tree, every branch at
  once. Click a message to switch the chat to its branch. Bookmarks show by
  name.
- **Bookmarks** (Alt+B, or the 🔖 on a message): name any message and jump
  back to it later, even when it is on another branch. Export and import as a
  JSON file.
- **Open at the newest message**: LibreChat opens a chat at the newest reply
  of the newest *first* message, which in a heavily branched chat can be a
  dead end. The extension goes to the newest message of the whole chat
  instead. A checkbox in the bookmarks panel turns this off.
- **Links to one message**: add `#lcjump=<messageId>` to a chat's address
  and the chat opens at that message, switching branches as needed.
- **Flip a turn's branches with the arrow keys**: mark a message (Alt+M, or
  the ⇆ in its button row), then ← and → switch between its versions.
  Shift+↑ and Shift+↓ move the mark, Esc removes it.

**Editing and reading**

- **Alt+Click a word** in any message to open the editor with that word
  selected. Select text first and Alt+Click it to edit at the selection.
- **Theme editor** (the palette button): LibreChat's dark-mode colors, the
  fonts, reply text size, line height and chat width. Save your own presets,
  export and import them. A "Claude dark" preset is included. Colors apply in
  dark mode only.
- **Skill tool calls**: a counter of how often the model loaded a skill by
  itself on the branch you are looking at, with a jump to each call.
- **Hotkey list** (Alt+K): every key the extension adds.

**In the message box**

- **Styles**: a pill that lists your skills. Tick one and it gets
  `always-apply: true` in its SKILL.md, so LibreChat puts it into every turn
  until you untick it. Save sets of styles as presets and switch between them
  with one click. Each skill can also be downloaded as a zip in the layout
  claude.ai's skill upload takes.
- **Prefill**: text that goes into every empty message box, with
  `{{cursor}}` for where the caret lands. A box that holds only the prefill
  is never sent.
- **Prompts**: your saved LibreChat prompts in a searchable list; the chosen
  one goes into the message box at the caret.

**Export**

- **Save a branch as a SillyTavern chat**: the 💾 button downloads the branch
  you are looking at as a `.jsonl` file that SillyTavern imports under Chat
  History.

## Install

Chrome, Edge, Brave and other Chromium browsers:

1. Download the zip from the Releases page and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `extension` folder.
4. Open LibreChat and reload the tab once.

### LibreChat at another address

Out of the box the extension runs on `http://localhost:3080`, LibreChat's
default. For any other address (another port, a home server, your own
domain):

1. Open your LibreChat in a tab.
2. Click the extension's icon in the toolbar.
3. Click **Turn on for this site**. Chrome asks for access to that one site;
   the page then reloads with the extension on.

The same popup turns it off again.

## What it needs

- **LibreChat v0.8.7.** The extension reads LibreChat's page and calls
  LibreChat's own HTTP API with the session you are logged in with. A
  LibreChat update that changes the page can break parts of it until the
  extension is updated; the selectors it depends on are collected in
  `extension/content/adapter.js`.
- The Styles pill needs LibreChat's **skills** feature, the Prompts pill its
  **prompts** feature.

It was built on a LibreChat install that carries extra source patches, and
has not yet been tried on an unpatched one. Where a patched build offers a
shortcut, the extension falls back to the stock way: branch jumps click the
`< n/m >` arrows one step at a time, and the ✎ next to a skill opens the
Skills page in a new tab. If something does not work on your install, please
open an issue with your LibreChat version.

## Privacy

The extension talks to your LibreChat and to nothing else. It has no
analytics, no account and no server of its own. Bookmarks, themes, presets
and settings stay in your browser. See [PRIVACY.md](PRIVACY.md).

## Limitations

- Bookmarks, presets and themes are stored per browser profile, not in
  LibreChat, so they do not follow you to another device. Bookmarks and
  themes can be exported and imported by hand.
- The theme editor changes dark mode only.
- Firefox is not supported (the extension uses Chrome's Manifest V3 APIs).

## Development

There is no build step: the extension is plain JavaScript content scripts,
loaded in the order listed in `extension/manifest.json`. Edit a file, reload
the extension on `chrome://extensions`, reload LibreChat.

## License

MIT. See [LICENSE](LICENSE).

"LibreChat" is the name of the project this extension is made for, and
"Claude" and "SillyTavern" are named only to say what a feature is compatible
with. This extension is not made or endorsed by any of them.
