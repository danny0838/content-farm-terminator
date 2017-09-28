const docUrlObj = new URL(document.location.href);
const docHostname = docUrlObj.hostname;
const docPathname = docUrlObj.pathname;
const anchorMarkerMap = new Map();
let lastRightClickedElem;

function getRedirectedUrlOrHostname(elem) {
  return Promise.resolve().then(() => {
    const u = new URL(elem.href);
    const h = u.hostname;
    const p = u.pathname;
    const s = u.searchParams;

    // Google
    // adopted from WOT: http://static-cdn.mywot.com/settings/extensions/serps.json
    if (/^(www\.|encrypted\.)?(google)\.([a-z]{2,3})(\.[a-z]{2,3})?$/.test(h)) {
      if (p === "/url" || p === "/interstitial") {
        return s.get("url") || s.get("q");
      }
    }

    // Bing (used rarely, e.g. in Egerin)
    else if (h === "www.bing.com") {
      if (p === "/cr") {
        return s.get("r");
      }
    }

    // Yahoo search (no javascript)
    else if (h === "r.search.yahoo.com") {
      return decodeURIComponent(p.match(/\/RU=(.*?)\//)[1]);
    }

    // Sina search
    else if (h.startsWith("find.sina.com.")) {
      if (p === "/sina_redirector.php") {
        return s.get("url");
      }
    }

    // Yandex search
    else if (h === "www.yandex.com") {
      if (p === "/clck/jsredir") {
        if (elem.matches('li.serp-item > div > h2 > a')) {
          const refNode = elem.closest('li.serp-item').querySelector('div > h2+div a > b');
          return refNode.textContent;
        }
      }
    }

    // WebCrawler mobile
    else if (h === "cs.webcrawler.com") {
      if (p === "/ClickHandler.ashx") {
        u.search = s.get("encp");
        return s.get("ru");
      }
    }

    // Dogpile
    else if (h === "ccs.dogpile.com") {
      if (p === "/ClickHandler.ashx") {
        u.search = s.get("encp");
        return s.get("ru");
      }
    }

    // info.com / msxml.excite.com
    else if (h === "ccs.infospace.com") {
      if (p === "/ClickHandler.ashx") {
        u.search = s.get("encp");
        return s.get("ru");
      }
    }

    // Search
    else if (h === "www.search.com") {
      if (p === "/wr_clk") {
        return s.get("surl");
      }
    }

    // Lycos
    else if (h === "search.lycos.com") {
      if (p === "/b.php") {
        return u.protocol + "//" + s.get("as");
      } else if (p === "/bnjs.php") {
        return s.get("as");
      }
    }

    // Qwant
    else if (h === "lite.qwant.com") {
      if (p.startsWith("/redirect/")) {
        return decodeURIComponent(p.match(/\/redirect\/[^\/]+\/(.*)$/)[1]);
      }
    }

    // Qwant Ads
    else if (/^\d+\.r\.bat\.bing\.com$/.test(h)) {
      if (p === "/") {
        if (docHostname === "lite.qwant.com" && docPathname === "/") {
          if (elem.matches('div.result a')) {
            const refNode = elem.closest('div.result').querySelector('p.url').cloneNode(true);
            refNode.querySelector('span').remove();
            return u.protocol + "//" + refNode.textContent.trim();
          }
        }
      }
    }

    // 百度
    else if (h === "www.baidu.com") {
      if (p === "/link") {
        if (docHostname === "www.baidu.com" && docPathname === "/s") {
          if (elem.matches('div.result > h3 > a, div.result div.general_image_pic a, div.result a.c-showurl')) {
            const refNode = elem.closest('div.result').querySelector('a.c-showurl');
            return refNode.textContent.replace(/^\w+:\/+/, "").replace(/\/.*$/, "");
          }
        }
      }
    }

    // 百度 mobile
    else if (h === "m.baidu.com") {
      if (p.startsWith("/from=0/")) {
        if (docHostname === "m.baidu.com" && docPathname === "/s") {
          if (elem.matches(':not(.koubei-a)')) {
            const refNode = elem.closest('div.c-container').querySelector('div.c-showurl span.c-showurl');
            return refNode.textContent.replace(/^\w+:\/+/, "").replace(/\/.*$/, "");
          }
        }
      }
    }

    // 搜狗
    else if (h === "www.sogou.com") {
      if (p.startsWith("/link")) {
        if (docHostname === "www.sogou.com") {
          if (docPathname === "/web" || docPathname === "/sogou" ) {
            const refNode = elem.closest('div.vrwrap, div.rb').querySelector('cite');
            return refNode.textContent.replace(/^.*? - /, "").replace(/[\/ \xA0][\s\S]*$/, "");
          }
        }
      }
    }

    // 搜狗 mobile
    else if (h === "m.sogou.com") {
      if (p.startsWith("/web/")) {
        return s.get("url");
      }
    }

    // 360搜索
    else if (h === "www.so.com") {
      if (p === "/link") {
        if (docHostname === "www.so.com" && docPathname === "/s") {
          return elem.getAttribute('data-url');
        }
      }
    }

    // 360搜索 mobile
    else if (h === "m.so.com") {
      if (p === "/jump") {
        return s.get("u");
      }
    }

    // Facebook / Facebook mobile
    else if (h === "l.facebook.com" || h === "lm.facebook.com") {
      if (p === "/l.php") {
        return s.get("u");
      }
    }

    // Twitter / Twitter mobile
    else if (h === "t.co") {
      if (docHostname === "twitter.com") {
        return elem.getAttribute("data-expanded-url");
      } else if (docHostname === "mobile.twitter.com") {
        const refNode = elem.querySelector('span');
        return refNode.textContent.match(/\(link: (.*?)\)/)[1];
      }
    }

    // Disqus
    else if (h === "disq.us") {
      if (p === "/") {
        return s.get("url");
      }
    }

    // Instagram
    else if (h === "l.instagram.com") {
      if (p === "/") {
        return s.get("u");
      }
    }

    // Tumblr
    else if (h === "t.umblr.com") {
      if (p === "/redirect") {
        return s.get("z");
      }
    }

    // Pocket
    else if (h === "getpocket.com") {
      if (p === "/redirect") {
        return s.get("url");
      }
    }

    // 巴哈姆特
    else if (h === "ref.gamer.com.tw") {
      if (p === "/redir.php") {
        return s.get("url");
      }
    }
  }).catch((ex) => {
    console.error(ex);
  });
}

function updateLinkMarker(elem) {
  // console.warn("updateLinkMarker", elem);
  return Promise.resolve().then(() => {
    if (!elem.parentNode || !elem.href) { return false; }

    const u = new URL(elem.href);
    const c = u.protocol;
    const h = u.hostname;
    if (!(c === "http:" || c === "https:")) { return false; }

    // check whether the hostname is blocked
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        cmd: 'isUrlBlocked',
        args: {url: h}
      }, resolve);
    }).then((isBlocked) => {
      if (isBlocked) { return true; }

      // check for a potential redirect by the current site (e.g. search engine or social network)
      return getRedirectedUrlOrHostname(elem).then((urlOrHostname) => {
        if (!urlOrHostname) { return false; }

        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            cmd: 'isUrlBlocked',
            args: {url: urlOrHostname}
          }, resolve);
        });
      });
    });
  }).then((willBlock) => {
    let marker = anchorMarkerMap.get(elem);
    if (willBlock) {
      if (!marker) {
        marker = elem.ownerDocument.createElement('img');
        marker.src = chrome.runtime.getURL('img/content-farm-marker.svg');
        marker.style = 'display: inline-block !important;' + 
          'visibility: visible !important;' + 
          'position: relative !important;' + 
          'float: none !important;' + 
          'margin: 0 !important;' + 
          'outline: 0 !important;' + 
          'border: 0 !important;' + 
          'padding: 0 !important;' + 
          'width: 1em !important; min-width: 12px !important; max-width: none !important;' + 
          'height: 1em !important; min-height: 12px !important; max-height: none !important;' + 
          'vertical-align: text-top !important;';
        marker.title = marker.alt = utils.lang('markTitle');
        marker.setAttribute("data-content-farm-terminator-marker", 1);
        anchorMarkerMap.set(elem, marker);
      }
      if (!marker.parentNode) {
        elem.insertBefore(marker, elem.firstChild);
      }
    } else {
      if (marker && marker.parentNode) { marker.remove(); }
    }
  });
}

function updateLinkMarkersAll(root = document) {
  const tasks = Array.from(root.querySelectorAll('a[href], area[href]'), updateLinkMarker);
  return Promise.all(tasks);
}

function observeDomUpdates() {
  const isAnchor = function (node) {
    let n = node.nodeName.toLowerCase();
    return n === "a" || n === "area";
  };

  const docObserver = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      // console.warn("DOM update", mutation);
      for (let node of mutation.addedNodes) {
        if (isAnchor(node)) {
          updateLinkMarker(node);
          ancObserver.observe(node, ancObserverConf);
        }
        if (node.nodeType === 1) {
          Array.prototype.forEach.call(node.querySelectorAll("a, area"), (elem) => {
            updateLinkMarker(elem);
            ancObserver.observe(elem, ancObserverConf);
          });
        }
      }
      for (let node of mutation.removedNodes) {
        if (isAnchor(node)) {
          updateLinkMarker(node);
        }
        if (node.nodeType === 1) {
          Array.prototype.forEach.call(node.querySelectorAll("a, area"), (elem) => {
            updateLinkMarker(elem);
          });
        }
      }
    }
  });
  const docObserverConf = {childList: true, subtree: true};

  const ancObserver = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      // console.warn("Anchor update", mutation);
      const node = mutation.target;
      updateLinkMarker(node);
    }
  });
  const ancObserverConf = {attributes: true, attributeFilter: ["href"]};

  docObserver.observe(document.documentElement, docObserverConf);
  Array.prototype.forEach.call(document.querySelectorAll("a, area"), (elem) => {
    ancObserver.observe(elem, ancObserverConf);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  //console.warn("omMessage", message);
  const {cmd, args} = message;
  switch (cmd) {
    case 'updateContent': {
      updateLinkMarkersAll();
      sendResponse(true);
      break;
    }
    case 'blockDomain': {
      const hostname = prompt(utils.lang("blockDomain"), args.hostname);
      sendResponse(hostname);
      break;
    }
    case 'getLinkHostname': {
      const anchor = lastRightClickedElem.closest('a[href], area[href]');
      getRedirectedUrlOrHostname(anchor).then((hostname) => {
        sendResponse(hostname);
      });
      return true; // async response
      break;
    }
  }
});

window.addEventListener("contextmenu", (event) => {
  lastRightClickedElem = event.target;
}, true);

// Remove stale link markers when the addon is re-enabled
Array.prototype.forEach.call(document.querySelectorAll('img[data-content-farm-terminator-marker]'), (elem) => {
  elem.remove();
});
observeDomUpdates();
updateLinkMarkersAll();
