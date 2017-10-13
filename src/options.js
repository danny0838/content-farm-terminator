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

  return utils.setOptions({
    userBlacklist: validator.validateRulesText(userBlacklist),
    userWhitelist: validator.validateRulesText(userWhitelist),
    webBlacklists: webBlacklists
  });
}

document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  loadOptions();

  document.querySelector('#resetButton').addEventListener('click', (event) => {
    event.preventDefault();
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
