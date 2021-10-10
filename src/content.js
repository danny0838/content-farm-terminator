const docUrlObj = new URL(location.href);
let docHref = docUrlObj.href;
let docHostname = docUrlObj.hostname;
let docPathname = docUrlObj.pathname;

const anchorMarkerMap = new Map();
let updateLinkMarkerPromise = Promise.resolve();
let lastRightClickedElem;
let showLinkMarkers = true;

/**
 * @param urlChanged {boolean} a recent URL change has been presumed
 * @return {boolean} whether document URL changed
 */
function recheckCurrentUrl(urlChanged = false) {
  return Promise.resolve().then(() => {
    // check for URL change of the address bar and update related global variables
    const href = location.href;
    if (href !== docHref) {
      docHref = docUrlObj.href = href;
      docHostname = docUrlObj.hostname;
      docPathname = docUrlObj.pathname;
      urlChanged = true;
    }

    // skip further check if document URL doesn't change
    if (!urlChanged) { return urlChanged; }

    return browser.runtime.sendMessage({
      cmd: 'isTempUnblocked',
      args: {},
    }).then((isTempUnblocked) => {
      // skip further check if this tab is temporarily unblocked
      if (isTempUnblocked) { return urlChanged; }

      // check if the current document URL is blocked
      return browser.runtime.sendMessage({
        cmd: 'isUrlBlocked',
        args: {url: docHref},
      }).then((blockType) => {
        if (blockType) {
          const inFrame = (self !== top);
          const redirectUrl = utils.getBlockedPageUrl(docHref, blockType, inFrame);
          location.replace(redirectUrl);
        }
        return urlChanged;
      });
    });
  }).catch((ex) => {
    console.error(ex);
  });
}

function getRedirectedUrlOrHostname(elem) {
  const me = getRedirectedUrlOrHostname;
  if (!me.cached) {
    me.cached = true;

    // adopted from WOT: http://static-cdn.mywot.com/settings/extensions/serps.json
    me.reGoogleTester = /^(www\.|encrypted\.)?(google)\.([a-z]{2,3})(\.[a-z]{2,3})?$/;

    me.reQwantAdsTester = /^\d+\.r\.bat\.bing\.com$/;
  }

  return Promise.resolve().then(() => {
    const u = new URL(elem.href);
    const h = u.hostname;
    const p = u.pathname;
    const s = u.searchParams;

    // Google
    if (me.reGoogleTester.test(h)) {
      if (p === "/url" || p === "/interstitial") {
        return s.get("url") || s.get("q");
      }
    }

    // Facebook / Facebook mobile
    else if (docHostname.substring(docHostname.indexOf(".") + 1) === "facebook.com" ||
        h === "l.facebook.com" || h === "lm.facebook.com") {
      // domain name detected by Facebook for shared link
      let domainName;
      if (docHostname.substring(docHostname.indexOf(".") + 1) === "facebook.com") {
        if (docHostname === "m.facebook.com") {
          try {
            domainName = elem.previousSibling.querySelector('header h4').textContent.trim().toLowerCase();
          } catch (ex) {}
        } else {
          try {
            domainName = elem.previousSibling.querySelector('div.ellipsis').textContent.trim();
          } catch (ex) {}
        }
      }

      // general reverse parse of Facebook redirect
      let url;
      if (h === "l.facebook.com" || h === "lm.facebook.com") {
        if (p === "/l.php") {
          url = s.get("u");
        }
      }

      if (domainName && url) {
        const d = utils.escapeRegExp(domainName);
        if (new RegExp('^https?://(?:www\.)?' + d + '(?=[:/?#]|$)').test(url)) {
          return url;
        } else {
          return domainName;
        }
      } else if (domainName) {
        return domainName;
      } else if (url) {
        return url;
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
    else if (me.reQwantAdsTester.test(h)) {
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
  return updateLinkMarkerPromise = updateLinkMarkerPromise.then(() => {
    if (!showLinkMarkers) { return false; }

    if (!elem.parentNode || !elem.href) { return false; }

    const u = new URL(elem.href);
    const c = u.protocol;
    if (!(c === "http:" || c === "https:")) { return false; }

    // check whether the URL is blocked
    return browser.runtime.sendMessage({
      cmd: 'isUrlBlocked',
      args: {url: u.href}
    }).then((blockType) => {
      if (blockType) { return true; }

      // check for a potential redirect by the current site (e.g. search engine or social network)
      return getRedirectedUrlOrHostname(elem).then((urlOrHostname) => {
        if (!urlOrHostname) { return false; }

        return browser.runtime.sendMessage({
          cmd: 'isUrlBlocked',
          args: {url: urlOrHostname}
        });
      });
    });
  }).then((willBlock) => {
    let marker = anchorMarkerMap.get(elem);
    if (willBlock) {
      if (!marker) {
        marker = elem.ownerDocument.createElement('img');
        marker.src = browser.runtime.getURL('img/content-farm-marker.svg');
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
        // insert before a non-blank text node preceeding all element nodes
        for (const node of elem.childNodes) {
          if (node.nodeType === 3 && node.nodeValue.trim()) {
            elem.insertBefore(marker, node);
            return;
          } else if (node.nodeType === 1) {
            break;
          }
        }

        // insert in the first header descendant
        for (const node of elem.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
          if (node.offsetParent && node.textContent.trim()) {
            node.insertBefore(marker, node.firstChild);
            return;
          }
        }

        // insert in the first span-like descendant
        for (const node of elem.querySelectorAll('span, div, b')) {
          if (node.offsetParent) {
            const firstChild = node.firstChild;
            if (firstChild && firstChild.nodeType === 3 && firstChild.nodeValue.trim()) {
              node.insertBefore(marker, firstChild);
              return;
            }
          }
        }

        // insert as the first anchor child 
        elem.insertBefore(marker, elem.firstChild);
      }
    } else {
      if (marker && marker.parentNode) { marker.remove(); }
    }
  }).catch((ex) => {
    console.error(ex);
  });
}

function updateLinkMarkersAll(root = document) {
  Array.prototype.forEach.call(root.querySelectorAll('a[href], area[href]'), (elem) => {
    updateLinkMarker(elem);
  });
  return updateLinkMarkerPromise;
}

function observeDomUpdates() {
  const isAnchor = (node) => {
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

browser.runtime.onMessage.addListener((message, sender) => {
  //console.warn("omMessage", message);
  const {cmd, args} = message;
  switch (cmd) {
    case 'updateContent': {
      // async update to prevent block
      utils.getOptions([
        "showLinkMarkers",
      ]).then((options) => {
        showLinkMarkers = options.showLinkMarkers;
        return updateLinkMarkersAll();
      });

      return Promise.resolve(true);
    }
    case 'blockSite': {
      const rule = prompt(utils.lang("blockSite"), args.rule);
      return Promise.resolve(rule);
    }
    case 'blockSites': {
      const confirmed = confirm(utils.lang("blockSites", args.rules.join('\n')));
      return Promise.resolve(confirmed);
    }
    case 'blockSelectedLinks': {
      const rv = [];
      const sel = document.getSelection();
      const nodeRange = document.createRange();
      for(let i = 0, I = sel.rangeCount; i < I; i++) {
        const range = sel.getRangeAt(i);
        if (range.collapsed) {
          continue;
        }
        const walker = document.createTreeWalker(range.commonAncestorContainer, 1, {
          acceptNode: (node) => {
            nodeRange.selectNode(node);
            if (nodeRange.compareBoundaryPoints(Range.START_TO_START, range) >= 0
                && nodeRange.compareBoundaryPoints(Range.END_TO_END, range) <= 0) {
              if (node.matches('a[href], area[href]')) {
                return NodeFilter.FILTER_ACCEPT;
              }
            }
            return NodeFilter.FILTER_SKIP;
          },
        });
        let node;
        while (node = walker.nextNode()) {
          const a = node;
          const p = getRedirectedUrlOrHostname(a).then((redirected) => {
            return redirected || a.href;
          }).catch((ex) => {});
          rv.push(p);
        }
      }
      return Promise.all(rv).then(rv => rv.filter(x => x));
    }
    case 'getRedirectedLinkUrl': {
      const anchor = lastRightClickedElem.closest('a[href], area[href]');
      return getRedirectedUrlOrHostname(anchor).then((urlOrHostname) => {
        return urlOrHostname;
      });
    }
    case 'alert': {
      alert(args.msg);
      return Promise.resolve(true);
    }
  }
});

function onPotentialUrlChange() {
  if (onPotentialUrlChange.checking) { return; }
  onPotentialUrlChange.checking = true;
  return recheckCurrentUrl().then((urlChanged) => {
    onPotentialUrlChange.checking = false;
  });
}

/**
 * Check for a potential document URL change
 *
 * There is no event handler for a URL change made by history.pushState
 * or history.replaceState. Use a perioridic recheck to do this.
 */
setInterval(onPotentialUrlChange, 750);

// address bar, click link, location.assign() with only hash change
window.addEventListener("hashchange", onPotentialUrlChange, true);

// history.back(), history.go()
window.addEventListener("popstate", onPotentialUrlChange, true);

window.addEventListener("contextmenu", (event) => {
  lastRightClickedElem = event.target;
}, true);

// Remove stale link markers when the addon is re-enabled
Array.prototype.forEach.call(document.querySelectorAll('img[data-content-farm-terminator-marker]'), (elem) => {
  elem.remove();
});

utils.getOptions([
  "showLinkMarkers",
]).then((options) => {
  showLinkMarkers = options.showLinkMarkers;

  // Check whether the current page is blocked, as a supplement
  // for content farm pages not blocked by background onBeforeRequest.
  // This could happen when the page is loaded before the extension
  // is loaded or before updateFilter is completed in the background script.
  //
  // @TODO: Some ads are still loaded even if we block the page here.
  return recheckCurrentUrl(true).then((urlChanged) => {
    observeDomUpdates();
    updateLinkMarkersAll();
  });
});
