function fixBlocklist(listText) {
  return (listText || "").split(/\n|\r\n?/).map((text) => {
    if (!text) { return ""; }
    try {
      var t = text;
      if (t.indexOf(":") === -1) { t = "http://" + t; }
      t = new URL(t).hostname.replace(/%2A/g, "*").replace(/^www\./, "");
      return t;
    } catch (ex) {}
    return "";
  }).join("\n");
}

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
    var userBlacklist = fixBlocklist(document.querySelector('#userBlacklist textarea').value);
    var userWhitelist = fixBlocklist(document.querySelector('#userWhitelist textarea').value);
    var webBlacklist = document.querySelector('#webBlacklist textarea').value;

    utils.setOptions({
      userBlacklist: userBlacklist,
      userWhitelist: userWhitelist,
      webBlacklist: webBlacklist
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
