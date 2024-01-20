async function loadOptions() {
  const options = await utils.getOptions();
  document.querySelector('#userBlacklist textarea').value = options.userBlacklist;
  document.querySelector('#userWhitelist textarea').value = options.userWhitelist;
  document.querySelector('#userGraylist textarea').value = options.userGraylist;
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
  const userGraylist = document.querySelector('#userGraylist textarea').value;
  const webBlacklists = document.querySelector('#webBlacklists textarea').value;
  const transformRules = document.querySelector('#transformRules textarea').value;
  let suppressHistory = document.querySelector('#suppressHistory input').checked;
  const showLinkMarkers = document.querySelector('#showLinkMarkers input').checked;
  const showContextMenuCommands = document.querySelector('#showContextMenuCommands input').checked;
  const quickContextMenuCommands = document.querySelector('#quickContextMenuCommands input').checked;
  const showUnblockButton = document.querySelector('#showUnblockButton input').checked;

  if (suppressHistory) {
    if (!(await browser.permissions.request({permissions: ['history']}).catch(ex => {
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
      userGraylist,
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
  const requestId = searchParams.get('r');
  let url = searchParams.get('url');
  let redirect;
  const isBlock = !!searchParams.get('block');

  if (!url) { return; }
  if (!(url.startsWith('https:') || url.startsWith('http:'))) { return; }

  if (Number.isInteger(tabId)) {
    const request = await browser.runtime.sendMessage({
      cmd: 'getRequestSummary',
      args: {tabId, requestId},
    });

    if (request.url !== url) {
      redirect = request.url;
    } else if (request.redirects && request.redirects.length) {
      redirect = request.redirects[request.redirects.length - 1][0];
    } else if (request.referrer) {
      redirect = request.referrer;
    }
  }

  {
    const urlRegex = `/^${utils.escapeRegExp(url, true)}$/`;
    document.querySelector('#infoUrl dd').textContent = url;
    document.querySelector('#infoUrlRegex dd').textContent = urlRegex;
    document.querySelector('#infoUrl').hidden = false;
    document.querySelector('#infoUrlRegex').hidden = false;
  }

  if (redirect) {
    const u = new URL(browser.runtime.getURL('requests.html'));
    if (tabId) { u.searchParams.set('t', tabId); }
    if (url) { u.searchParams.set('url', url); }

    const anchor = document.createElement('a');
    anchor.href = u.href;
    anchor.textContent = redirect;

    document.querySelector('#infoUrlReferrer dd').appendChild(anchor);
    document.querySelector('#infoUrlReferrer').hidden = false;
  }

  if (isBlock) {
    document.querySelector('#infoUrl dt').textContent = utils.lang('infoUrlBlocked');
    document.querySelector('#infoUrlRegex dt').textContent = utils.lang('infoUrlBlockedRegex');
  }

  const blocker = await browser.runtime.sendMessage({
    cmd: 'getBlocker',
    args: {url, details: true},
  });

  const rule = blocker.rule;
  if (!rule) {
    return;
  }

  document.querySelector('#infoUrlBlocker').hidden = false;
  document.querySelector('#infoUrlBlockerSrc').hidden = false;
  document.querySelector('#infoUrlBlocker dd').textContent = [rule.rule, rule.sep, rule.comment].join('');
  document.querySelector('#infoUrlBlockerSrc dd').textContent = 
    rule.action === 0 << 4 /* RULE_ACTION_BLOCK */ ? utils.lang('userBlacklist') :
    rule.action === 1 << 4 /* RULE_ACTION_UNBLOCK */ ? utils.lang('userWhitelist') :
    rule.action === 2 << 4 /* RULE_ACTION_NOOP */ ? utils.lang('userGraylist') :
    '' /* this shouldn't happen */;

  if (rule.src) {
    const u = new URL(browser.runtime.getURL('blacklists.html'));
    u.searchParams.set('url', rule.src);

    const wrapper = document.querySelector('#infoUrlBlockerSrc dd');
    wrapper.textContent = '';
    const anchor = wrapper.appendChild(document.createElement('a'));
    anchor.textContent = rule.src;
    anchor.href = u.href;
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
  // Chromium mobile (e.g. Kiwi): cannot call browser.permissions.request()
  // Firefox for Android: no browser.history. However, we cannot simply check
  // browser.history as it's undefined before granted permission.
  if (utils.userAgent.soup.has('mobile')) {
    document.querySelector('#suppressHistory').hidden = true;
  }

  loadOptions().then(() => {
    document.querySelector('#submitButton').disabled = false;
  }); // async
  showInfo(); // async
}

document.addEventListener('DOMContentLoaded', init);
