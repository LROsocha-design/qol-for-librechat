/**
 * POPUP — turn the extension on or off for the site in the current tab.
 *
 * LibreChat is self-hosted, so it can live at any address. The extension
 * runs on http://localhost:3080 out of the box; for any other address the
 * user opens their LibreChat, clicks the extension's icon and presses
 * "Turn on for this site". Chrome then asks for access to that one site, and
 * background.js registers the content scripts for it.
 */
const BUILT_IN = ["http://localhost:3080/*", "http://127.0.0.1:3080/*"];

const $ = (id) => document.getElementById(id);

function show(site, state, on, button, note) {
  $('site').textContent = site;
  $('state').textContent = state;
  $('state').classList.toggle('on', on);
  const toggle = $('toggle');
  toggle.hidden = !button;
  if (button) {
    toggle.textContent = button.label;
    toggle.classList.toggle('off', !!button.quiet);
    toggle.onclick = button.run;
  }
  $('note').textContent = note || '';
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = null;
  try {
    url = new URL(tab.url);
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol)) {
    show('(not a web page)', 'Open your LibreChat in a tab, then click this icon again.', false, null, '');
    return;
  }
  const pattern = `${url.origin}/*`;
  if (BUILT_IN.includes(pattern)) {
    show(url.origin, 'On. This address is built in.', true, null, '');
    return;
  }
  const on = await chrome.permissions.contains({ origins: [pattern] });
  if (on) {
    show(url.origin, 'On for this site.', true, {
      label: 'Turn off for this site',
      quiet: true,
      run: async () => {
        await chrome.permissions.remove({ origins: [pattern] });
        chrome.tabs.reload(tab.id);
        render();
      },
    });
    return;
  }
  show(
    url.origin,
    'Off for this site.',
    false,
    {
      label: 'Turn on for this site',
      /** Must run straight from the click: Chrome only shows its permission question then. */
      run: () => {
        chrome.permissions.request({ origins: [pattern] }).then((granted) => {
          if (granted) render();
        });
      },
    },
    'Only turn it on for your own LibreChat. Chrome will ask for access to this one site; the page reloads once it is on.',
  );
}

render();
