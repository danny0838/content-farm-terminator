var docUrlObj = new URL(document.location.href);

function markContentFarmLink(elem) {
  let doc = elem.ownerDocument;

  return Promise.resolve().then(() => {
    let u = new URL(elem.href);
    let s = u.searchParams;

    // fix redirects by search engine or social network
    return Promise.resolve().then(() => {
      // Google (mobile of no javascript)
      if (u.host.startsWith("www.google.com.") && u.pathname == "/url") {
        let u = s.get("q") || s.get("url");
        if (u) { return new URL(u).hostname; }
      // Yahoo search
      } else if (u.host == "r.search.yahoo.com") {
        return new URL(decodeURIComponent(u.pathname.match(/\/RU=(.*?)\//)[1])).hostname;
      // Sina search
      } else if (u.host.startsWith("find.sina.com.") && u.pathname == "/sina_redirector.php") {
        let u = s.get("url");
        if (u) { return new URL(u).hostname; }
      // 百度
      } else if (docUrlObj.host == "www.baidu.com" && docUrlObj.pathname == "/s" &&
          u.host == "www.baidu.com" && u.pathname == "/link") {
        try {
          let refNode = elem.closest('div.result').querySelector('a.c-showurl');
          let hostname = refNode.textContent.replace(/^\w+:\/+/, "").replace(/\/.*$/, "");
          return hostname;
        } catch (ex) {}
      // 百度 mobile
      } else if (docUrlObj.host == "m.baidu.com" && docUrlObj.pathname == "/s" &&
          u.host == "m.baidu.com" && u.pathname.startsWith("/from=0/")) {
        try {
          let refNode = elem.closest('div.c-container').querySelector('div.c-showurl span.c-showurl');
          let hostname = refNode.textContent.replace(/^\w+:\/+/, "").replace(/\/.*$/, "");
          return hostname;
        } catch (ex) {}
      // 搜狗
      } else if (docUrlObj.host == "www.sogou.com" && docUrlObj.pathname == "/sogou" &&
          u.host == "www.sogou.com" && u.pathname.startsWith("/link")) {
        try {
          let refNode = elem.closest('div.vrwrap, div.rb').querySelector('cite');
          let hostname = refNode.textContent.replace(/^.*? - /, "").replace(/[\/ \xA0][\s\S]*$/, "");
          return hostname;
        } catch (ex) {}
      // 搜狗 mobile
      } else if (u.host == "m.sogou.com" && u.pathname.startsWith("/web/")) {
        let u = s.get("url");
        if (u) { return new URL(u).hostname; }
      }
    }).catch((ex) => {
      console.error(ex);
    }).then((hostname) => {
      return hostname || u.hostname;
    });
  }).then((hostname) => {
    // The document is currently viewing and thus allowed expicitly by the user.
    // Do not mark links targeting the same domain.
    if (hostname === docUrlObj.hostname) {
      return;
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        cmd: 'isUrlBlocked',
        args: {url: hostname, ignoreTemp: true}
      }, resolve);
    }).then((isBlocked) => {
      if (isBlocked) {
        let img = doc.createElement('img');
        img.src = chrome.runtime.getURL('img/content-farm-marker.svg');
        img.style.margin = '0';
        img.style.border = '0';
        img.style.padding = '0';
        img.style.width = '1em';
        img.style.height = '1em';
        img.style.display = 'inline';
        img.style.position = 'relative';
        img.title = img.alt = utils.lang('markTitle');
        img.setAttribute("data-content-farm-terminator-marker", 1);
        elem.parentNode.insertBefore(img, elem);
      }
    });
  }).catch((ex) => {
    console.error(ex);
  });
}

function markContentFarmLinks(root = document) {
  Array.prototype.forEach.call(root.querySelectorAll('img[data-content-farm-terminator-marker]'), (elem) => {
    elem.remove();
  });
  var tasks = Array.from(root.querySelectorAll('a[href], area[href]')).map((elem) => {
    return markContentFarmLink(elem);
  });
  return Promise.all(tasks);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  //console.warn("omMessage", message);
  var {cmd, args} = message;
  switch (cmd) {
    case 'updateContent': {
      markContentFarmLinks();
      sendResponse(true);
      break;
    }
  }
});

markContentFarmLinks();
