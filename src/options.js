async function loadOptions() {
  const options = await utils.getOptions();
  document.querySelector('#userBlacklist textarea').value = options.userBlacklist;
  document.querySelector('#userWhitelist textarea').value = options.userWhitelist;
  document.querySelector('#webBlacklists textarea').value = options.webBlacklists;
  document.querySelector('#transformRules textarea').value = options.transformRules;
  document.querySelector('#suppressHistory input').checked = options.suppressHistory;
  document.querySelector('#showLinkMarkers input').checked = options.showLinkMarkers;
  document.querySelector('#showContextMenuCommands input').checked = options.showContextMenuCommands;
  document.querySelector('#quickContextMenuCommands input').checked = options.quickContextMenuCommands;
  document.querySelector('#showUnblockButton input').checked = options.showUnblockButton;
}

async function saveOptions() {
  const userBlacklist = document.querySelector('#userBlacklist textarea').value;
  const userWhitelist = document.querySelector('#userWhitelist textarea').value;
  const webBlacklists = document.querySelector('#webBlacklists textarea').value;
  const transformRules = document.querySelector('#transformRules textarea').value;
  let suppressHistory = document.querySelector('#suppressHistory input').checked;
  const showLinkMarkers = document.querySelector('#showLinkMarkers input').checked;
  const showContextMenuCommands = document.querySelector('#showContextMenuCommands input').checked;
  const quickContextMenuCommands = document.querySelector('#quickContextMenuCommands input').checked;
  const showUnblockButton = document.querySelector('#showUnblockButton input').checked;

  if (suppressHistory) {
    // @FIXME:
    // Firefox < 54: No browser.permissions.
    // Firefox < 56: the request dialog prompts repeatedly even if the
    // permissions are already granted. Checking permissions.contains() in
    // prior doesn't work as Promise.then() breaks tracing of the user input
    // event handler and makes the request always fail.
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1398833
    if (!(browser.permissions && await browser.permissions.request({permissions: ['history']}).catch(ex => {
      console.error(ex);
      return false;
    }))) {
      suppressHistory = document.querySelector('#suppressHistory input').checked = false;
    }
  }

  return await browser.runtime.sendMessage({
    cmd: 'updateOptions',
    args: {
      userBlacklist,
      userWhitelist,
      webBlacklists,
      transformRules,
      suppressHistory,
      showLinkMarkers,
      showContextMenuCommands,
      quickContextMenuCommands,
      showUnblockButton,
    },
  });
}

async function onReset(event) {
  event.preventDefault();
  if (!confirm(utils.lang("resetConfirm"))) {
    return;
  }
  await utils.clearOptions();
  await loadOptions();
}

async function onSubmit(event) {
  event.preventDefault();
  await saveOptions();
  await utils.back();
}

async function showInfo() {
  const searchParams = new URL(location.href).searchParams;

  const tabId = parseInt(searchParams.get('t'), 10);
  let url = searchParams.get('url');
  let referrer = searchParams.get('ref');
  const blockType = parseInt(searchParams.get('type'), 10);

  if (Number.isInteger(tabId)) {
    const tab = await browser.runtime.sendMessage({
      cmd: 'getTabInfo',
      args: {tabId},
    });
    url = tab.url;
    referrer = tab.referrer;
  }

  if (!url) { return; }

  if (url.startsWith('https:') || url.startsWith('http:')) {
    const urlRegex = `/^${utils.escapeRegExp(url, true)}$/`;
    document.querySelector('#infoUrl dd').textContent = url;
    document.querySelector('#infoUrlRegex dd').textContent = urlRegex;
    document.querySelector('#infoUrl').hidden = false;
    document.querySelector('#infoUrlRegex').hidden = false;
  }

  if (referrer && (referrer.startsWith('https:') || referrer.startsWith('http:'))) {
    const referrerRegex = `/^${utils.escapeRegExp(referrer, true)}$/`;
    document.querySelector('#infoUrlReferrer dd').textContent = referrer;
    document.querySelector('#infoUrlReferrerRegex dd').textContent = referrerRegex;
    document.querySelector('#infoUrlReferrer').hidden = false;
    document.querySelector('#infoUrlReferrerRegex').hidden = false;
  }

  if (blockType > 0) {
    document.querySelector('#infoUrl dt').textContent = utils.lang('infoUrlBlocked');
    document.querySelector('#infoUrlRegex dt').textContent = utils.lang('infoUrlBlockedRegex');

    const blocker = await browser.runtime.sendMessage({
      cmd: 'getBlocker',
      args: {url},
    });

    const rule = blocker.rule;
    if (!rule) {
      // this shouldn't happen
      return;
    }

    document.querySelector('#infoUrlBlocker').hidden = false;
    document.querySelector('#infoUrlBlockerSrc').hidden = false;
    document.querySelector('#infoUrlBlocker dd').textContent = [rule.rule, rule.sep, rule.comment].join('');

    if (rule.src) {
      const u = new URL(browser.runtime.getURL('blacklists.html'));
      u.searchParams.set('url', rule.src);

      const anchor = document.querySelector('#infoUrlBlockerSrc dd').appendChild(document.createElement('a'));
      anchor.textContent = rule.src;
      anchor.href = u.href;
    }
  }
}

async function init(event) {
  document.querySelector('#resetButton').addEventListener('click', onReset);
  document.querySelector('#submitButton').addEventListener('click', onSubmit);

  utils.loadLanguages(document);

  // hide some options if contextMenus is not available
  // (e.g. Firefox for Android)
  if (!browser.contextMenus || utils.userAgent.soup.has('mobile')) {
    document.querySelector('#showContextMenuCommands').hidden = true;
    document.querySelector('#quickContextMenuCommands').hidden = true;
  }

  // hide some options if browser.history is not available
  // Firefox < 55: no browser.permissions, and permissions listed in
  // "optional_permissions" are ignored.
  // Chromium mobile (e.g. Kiwi): cannot call browser.permissions.request()
  // Firefox for Android: no browser.history. However, we cannot simply check
  // browser.history as it's undefined before granted permission.
  if (!browser.permissions && !browser.history || utils.userAgent.soup.has('mobile')) {
    document.querySelector('#suppressHistory').hidden = true;
  }

  loadOptions(); // async
  showInfo(); // async
}

document.addEventListener('DOMContentLoaded', init);
