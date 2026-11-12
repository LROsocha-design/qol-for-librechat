# Privacy

QoL for LibreChat collects nothing and sends nothing to its author or to any
third party.

- **Network:** the extension only makes requests to the LibreChat site it
  runs on, using the session you are already logged in with there. It reads
  the messages of the chat you have open, your skills and your saved prompts,
  and it writes only what you ask for: the `always-apply` line and the on/off
  switch of a skill you tick or untick, and a use count for a prompt you
  insert.
- **Storage:** bookmarks, branch marks, theme settings, style presets, the
  prefill text and the extension's options are kept in your browser
  (extension storage and the LibreChat page's local storage). Removing the
  extension removes its extension storage.
- **Permissions:** `storage` keeps the settings above. `scripting` and
  `activeTab` are used only when you click "Turn on for this site" in the
  popup, to run the extension on a LibreChat address you chose. Access to a
  site is requested for that one site, when you ask for it, and can be taken
  back from the same popup.
- **No analytics, no ads, no remote code.**
