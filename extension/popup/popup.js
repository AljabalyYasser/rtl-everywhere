const toggle = document.getElementById('toggle');
const hostEl = document.getElementById('host');
const state = document.getElementById('state');

function showState(on) {
  state.textContent = on
    ? 'الإضافة شغالة هنا. إذا لاحظت إن الموقع تخرب أطفها من الزر'
    : 'الإضافة موقفة في هذا الموقع بس. باقي المواقع شغالة عادي';
}

// العنوان ممكن ينرسل للنافذة في الاختبار المحلي
const testUrl = new URLSearchParams(location.search).get('url');

chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  let host = '';
  try {
    const url = new URL(testUrl || tab.url);
    if (url.protocol === 'http:' || url.protocol === 'https:') host = url.hostname;
  } catch (e) { /* صفحة بدون عنوان */ }

  if (!host) {
    document.getElementById('no-site').hidden = false;
    return;
  }

  document.getElementById('on-site').hidden = false;
  hostEl.textContent = host;

  const { off } = await chrome.storage.local.get({ off: [] });
  toggle.checked = !off.includes(host);
  showState(toggle.checked);

  toggle.addEventListener('change', async () => {
    const { off } = await chrome.storage.local.get({ off: [] });
    const list = off.filter((h) => h !== host);
    if (!toggle.checked) list.push(host);
    await chrome.storage.local.set({ off: list });
    showState(toggle.checked);
  });
});

document.getElementById('welcome').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
});
