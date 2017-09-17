document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  fetch(chrome.runtime.getURL('blacklist.txt')).then((response) => {
    return response.text();
  }).then((text) => {
    document.querySelector('#systemBlacklist textarea').value = text.trim();
  });

  utils.getOptions({
    userBlacklist: "",
    userWhitelist: "",
    webBlacklist: ""
  }).then((options) => {
    document.querySelector('#userBlacklist textarea').value = options.userBlacklist;
    document.querySelector('#userWhitelist textarea').value = options.userWhitelist;
    document.querySelector('#webBlacklist textarea').value = options.webBlacklist;
  }).catch((ex) => {
    console.error(ex);
  });

  document.querySelector('#submitButton').addEventListener('click', (event) => {
    event.preventDefault();
    utils.setOptions({
      userBlacklist: document.querySelector('#userBlacklist textarea').value,
      userWhitelist: document.querySelector('#userWhitelist textarea').value,
      webBlacklist: document.querySelector('#webBlacklist textarea').value
    }).then(() => {
      if (history.length > 1) {
        history.go(-1);
      } else {
        chrome.runtime.sendMessage({
          cmd: 'closeTab'
        });
      }
    }).catch((ex) => {
      console.error(ex);
    });
  });
});
