/**
 * CONFIG — what this copy of the extension is set up for. Loaded first.
 *
 * This is the public build: everything that needs a helper program next to
 * LibreChat is off. The fields are read by the other scripts:
 *
 *   inspectorUrl     Base URL of a prompt-recording proxy, '' = none.
 *   stSaveEndpoint   Where the SillyTavern export POSTs the .jsonl, '' = let
 *                    the browser download it.
 *   stSaveFolder     Shown in the export dialog: where that endpoint writes.
 *   stDefaultUser /  Names prefilled in the export dialog the first time.
 *   stDefaultChar
 *   stRenames        [from, to] pairs applied to a stored character name.
 *   skillHistory     The skill editor has a History of older versions (a
 *                    LibreChat patch), so the skill-call window may point to it.
 *   patchHotkeys     Also list hotkeys that only a patched LibreChat has.
 */
(() => {
  'use strict';

  const LCBM = (window.LCBM = window.LCBM || {});

  LCBM.config = {
    inspectorUrl: '',
    stSaveEndpoint: '',
    stSaveFolder: '',
    stDefaultUser: 'User',
    stDefaultChar: 'Assistant',
    stRenames: [],
    skillHistory: false,
    patchHotkeys: false,
  };
})();
