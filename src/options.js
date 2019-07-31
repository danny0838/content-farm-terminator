const validator = new ContentFarmFilter();

function quit() {
  if (history.length > 1) {
    history.go(-1);
  } else {
    chrome.tabs.getCurrent((tab) => {
      chrome.runtime.sendMessage({
        cmd: 'closeTab',
        args: {tabId: tab.id}
      });
    });
  }
}

function loadOptions() {
  return utils.getDefaultOptions().then((options) => {
    document.querySelector('#userBlacklist textarea').value = options.userBlacklist;
    document.querySelector('#userWhitelist textarea').value = options.userWhitelist;
    document.querySelector('#webBlacklists textarea').value = options.webBlacklists;
    document.querySelector('#transformRules textarea').value = options.transformRules;
    document.querySelector('#showLinkMarkers input').checked = options.showLinkMarkers;
    document.querySelector('#showContextMenuCommands input').checked = options.showContextMenuCommands;
    document.querySelector('#quickContextMenuCommands input').checked = options.quickContextMenuCommands;
    document.querySelector('#showUnblockButton input').checked = options.showUnblockButton;

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        cmd: 'getMergedBlacklist',
      }, resolve);
    }).then((blacklist) => {
      document.querySelector('#allBlacklist textarea').value = blacklist;
    });
  });
}

function saveOptions() {
  const userBlacklist = document.querySelector('#userBlacklist textarea').value;
  const userWhitelist = document.querySelector('#userWhitelist textarea').value;
  const webBlacklists = document.querySelector('#webBlacklists textarea').value;
  const transformRules = document.querySelector('#transformRules textarea').value;
  const showLinkMarkers = document.querySelector('#showLinkMarkers input').checked;
  const showContextMenuCommands = document.querySelector('#showContextMenuCommands input').checked;
  const quickContextMenuCommands = document.querySelector('#quickContextMenuCommands input').checked;
  const showUnblockButton = document.querySelector('#showUnblockButton input').checked;

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      cmd: 'updateOptions',
      args: {
        userBlacklist,
        userWhitelist,
        webBlacklists,
        transformRules,
        showLinkMarkers,
        showContextMenuCommands,
        quickContextMenuCommands,
        showUnblockButton,
      },
    }, (result) => {
      result ? resolve(result) : reject(new Error('Unable to save options.'));
    });
  });
}

document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  // hide some options if contextMenus is not available
  // (e.g. Firefox for Android)
  if (!chrome.contextMenus) {
    document.querySelector('#transformRules').hidden = true;
    document.querySelector('#showContextMenuCommands').hidden = true;
  }

  loadOptions();

  try {
    const url = new URL(location.href).searchParams.get('from');
    if (url) {
      const urlRegex = `/^${utils.escapeRegExp(url, true)}$/`;
      document.querySelector('#urlInfo').textContent = utils.lang('urlInfo', [url, urlRegex]);
    }
  } catch (ex) {
    console.error(ex);
  }

  document.querySelector('#resetButton').addEventListener('click', (event) => {
    event.preventDefault();
    if (!confirm(utils.lang("resetConfirm"))) {
      return;
    }
    return utils.clearOptions().then(() => {
      return loadOptions();
    });
  });

  document.querySelector('#submitButton').addEventListener('click', (event) => {
    event.preventDefault();
    return saveOptions().then(() => {
      return quit();
    });
  });
});
