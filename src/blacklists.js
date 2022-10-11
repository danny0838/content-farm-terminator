const handler = new ContentFarmFilter();

async function showAllBlacklists() {
  const {webBlacklists} = await utils.getOptions(["webBlacklists"]);
  const handler = new ContentFarmFilter();
  const urls = handler.urlsTextToLines(webBlacklists);
  const wrapper = document.body.appendChild(document.createElement('ul'));
  const u = new URL(browser.runtime.getURL('blacklists.html'));
  const anchors = [];
  for (const url of urls) {
    u.searchParams.set('url', url);
    const li = wrapper.appendChild(document.createElement('li'));
    const anchor = li.appendChild(document.createElement('a'));
    anchor.textContent = url;
    anchor.href = u.href;
    anchor.setAttribute('data-src', url);
    anchors.push(anchor);
  }
  for (const anchor of anchors) {
    const url = anchor.getAttribute('data-src');
    const {time} = await handler.getCachedWebBlackList(url);
    if (time) {
      const span = document.createElement('span');
      span.textContent = ` (${new Date(time).toLocaleString()})`;
      anchor.after(span);
    }
  }
}

async function showCachedBlocklist(url) {
  document.title = url;
  const {text: blacklist} = await handler.getCachedWebBlackList(url);
  if (blacklist) {
    const pre = document.body.appendChild(document.createElement('pre'));
    pre.textContent = blacklist;
  }
}

async function init(event) {
  utils.loadLanguages(document);

  const params = new URL(location.href).searchParams;
  const sourceUrl = params.get('url');

  if (!sourceUrl) {
    await showAllBlacklists();
  } else {
    await showCachedBlocklist(sourceUrl);
  }
}

document.addEventListener('DOMContentLoaded', init);
