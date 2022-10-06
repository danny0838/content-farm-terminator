async function showAllBlacklists() {
  const blacklists = await browser.runtime.sendMessage({
    cmd: 'getWebBlacklists',
  });

  const wrapper = document.body.appendChild(document.createElement('ul'));

  addAllListsLink: {
    const u = new URL(browser.runtime.getURL('blacklists.html'));
    u.searchParams.set('url', '*');

    const li = wrapper.appendChild(document.createElement('li'));
    const anchor = li.appendChild(document.createElement('a'));
    anchor.textContent = utils.lang('blacklistsAllLabel');
    anchor.href = u.href;
  }

  for (const url of blacklists) {
    const u = new URL(browser.runtime.getURL('blacklists.html'));
    u.searchParams.set('url', url);

    const li = wrapper.appendChild(document.createElement('li'));
    const anchor = li.appendChild(document.createElement('a'));
    anchor.textContent = url;
    anchor.href = u.href;
  }
}

async function showMergedBlacklists() {
  document.title = utils.lang('blacklistsAllTitle');
  const blacklist = await browser.runtime.sendMessage({
    cmd: 'getMergedBlacklist',
  });
  const pre = document.body.appendChild(document.createElement('pre'));
  pre.textContent = blacklist;
}

async function showCachedBlocklist(url) {
  document.title = url;
  const handler = new ContentFarmFilter();
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
  } else if (sourceUrl === '*') {
    await showMergedBlacklists();
  } else {
    await showCachedBlocklist(sourceUrl);
  }
}

document.addEventListener('DOMContentLoaded', init);
