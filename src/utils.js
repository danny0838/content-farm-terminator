const utils = {
  /**
   * Options
   *
   * Use sync storage as viable, fallback to local storage.
   *
   * - get: load priority as local > sync > default
   *
   * - set: store to sync, if succeeds, remove corresponding keys from local
   *   (so that new data synced from other terminals will be used); and store
   *   to local if failed.
   *
   *   A set could fail due to:
   *   - storage.sync not available: storage.sync is undefined in Firefox < 52;
   *     storage.sync methods fail if Firefox config
   *     webextensions.storage.sync.enabled is not set to true.
   *   - the data to be stored exceeds quota or other limit
   *   - other unclear reason (during data syncing?)
   *
   * - clear: clear sync and local
   */
  defaultOptions: {
    userBlacklist: "",
    userWhitelist: "",
    webBlacklists: "https://danny0838.github.io/content-farm-terminator/files/blocklist/content-farms.txt",
    webBlacklistsCacheDuration: 24 * 60 * 60 * 1000,
    webBlacklistsUpdateInterval: 30 * 60 * 60 * 1000,
    transformRules: "",
    suppressHistory: false,
    showLinkMarkers: true,
    showContextMenuCommands: true,
    quickContextMenuCommands: false,
    showUnblockButton: true,
    tempUnblockDuration: 8000,
    tempUnblockCountdownBase: 10000,
    tempUnblockCountdownIncrement: 5000,
    tempUnblockCountdownReset: 24 * 60 * 60 * 1000,
    tempUnblockCountdown: -1,
    tempUnblockLastAccess: -1,
  },

  /**
   * Use storage.local > storage.sync > passed values
   *
   * @param {string|string[]|Object} [options] - An object for key-value pairs,
   *     or key(s) with corresponding values of defaultOptions.
   */
  getOptions(options = this.defaultOptions) {
    if (typeof options === "string") {
      options = {[options]: this.defaultOptions[options]};
    } else if (Array.isArray(options)) {
      options = options.reduce((rv, key) => {
        rv[key] = this.defaultOptions[key];
        return rv;
      }, {});
    }
    const keys = Object.keys(options);
    return browser.storage.sync.get(keys)
      .catch((ex) => {})
      .then((syncResult) => {
        // merge options from storage.local to options from storage.sync
        return browser.storage.local.get(keys)
          .then((result) => {
            return Object.assign({}, options, syncResult, result);
          });
      });
  },

  setOptions(options) {
    return browser.storage.sync.set(options)
      .then(() => {
        return browser.storage.local.remove(Object.keys(options));
      }, (ex) => {
        return browser.storage.local.set(options);
      });
  },

  clearOptions() {
    return browser.storage.sync.clear()
      .catch((ex) => {})
      .then(() => {
        return browser.storage.local.clear();
      });
  },

  /**
   * ref: source code of vAPI.webextFlavor of uBlock Origin
   */
  get userAgent() {
    const ua = navigator.userAgent;
    const soup = new Set(['webext']);
    const flavor = {
      major: 0,
      soup: soup,
    };

    const dispatch = () => {
      window.dispatchEvent(new CustomEvent('browserInfoLoaded'));
    };

    // Whether this is a dev build.
    if (/^\d+\.\d+\.\d+\D/.test(browser.runtime.getManifest().version)) {
      soup.add('devbuild');
    }

    if (/\bMobile\b/.test(ua)) {
      soup.add('mobile');
    }

    // Asynchronous
    Promise.resolve().then(() => {
      return browser.runtime.getBrowserInfo();
    }).then((info) => {
      flavor.major = parseInt(info.version, 10) || 0;
      soup.add(info.vendor.toLowerCase());
      soup.add(info.name.toLowerCase());
      soup.delete('user_stylesheet');
      if (flavor.major >= 53) { soup.add('user_stylesheet'); }
      soup.delete('html_filtering');
      if (flavor.major >= 57) { soup.add('html_filtering'); }
      dispatch();
    }, (ex) => {
      // dummy event for potential listeners
      dispatch();
    }).catch((ex) => {
      console.error(ex);
    });

    // Synchronous -- order of tests is important
    var match;
    if ((match = /\bFirefox\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('mozilla').add('firefox');
      if (flavor.major >= 53) { soup.add('user_stylesheet'); }
      if (flavor.major >= 57) { soup.add('html_filtering'); }
    } else if ((match = /\bEdge\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('microsoft').add('edge');
    } else if ((match = /\bOPR\/(\d+)/.exec(ua)) !== null) {
      const reEx = /\bChrom(?:e|ium)\/([\d.]+)/;
      if (reEx.test(ua)) { match = reEx.exec(ua); }
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('opera').add('chromium');
    } else if ((match = /\bChromium\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('chromium');
    } else if ((match = /\bChrome\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('google').add('chromium');
    } else if ((match = /\bSafari\/(\d+)/.exec(ua)) !== null) {
      flavor.major = parseInt(match[1], 10) || 0;
      soup.add('apple').add('safari');
    }

    // https://github.com/gorhill/uBlock/issues/3588
    if (soup.has('chromium') && flavor.major >= 66) {
      soup.add('user_stylesheet');
    }

    Object.defineProperty(this, 'userAgent', { value: flavor });
    return flavor;
  },

  lang(key, args) {
    return browser.i18n.getMessage(key, args) || "__MSG_" + key + "__";
  },

  loadLanguages(...args) {
    const reReplacer = /__MSG_(.*?)__/;
    const fnReplacer = (m, k) => utils.lang(k);
    const fn = this.loadLanguages = (rootNode = document) => {
      Array.prototype.forEach.call(rootNode.getElementsByTagName("*"), (elem) => {
        if (elem.childNodes.length === 1) {
          const child = elem.firstChild;
          if (child.nodeType === 3) {
            child.nodeValue = child.nodeValue.replace(reReplacer, fnReplacer);
          }
        }
        Array.prototype.forEach.call(elem.attributes, (attr) => {
          attr.nodeValue = attr.nodeValue.replace(reReplacer, fnReplacer);
        }, this);
      }, this);
    };
    return fn(...args);
  },

  escapeHtml(...args) {
    const reEscaper = /[&<>"']| (?= )/g;
    const mapEscaper = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
      " ": "&nbsp;"
    };
    const fnEscaper = m => mapEscaper[m];
    const fn = this.escapeHtml = (str, noDoubleQuotes = false, singleQuotes = false, spaces = false) => {
      mapEscaper['"'] = noDoubleQuotes ? '"' : "&quot;";
      mapEscaper["'"] = singleQuotes ? "&#39;" : "'";
      mapEscaper[" "] = spaces ? "&nbsp;" : " ";
      return str.replace(reEscaper, fnEscaper);
    };
    return fn(...args);
  },

  escapeRegExp(...args) {
    const reStandard = /[-\/\\^$*+?.|()[\]{}]/g;
    const reSimple = /[\\^$*+?.|()[\]{}]/g;
    const fn = this.escapeRegExp = (str, simple) => {
      if (simple) {
        // Do not escape "-" and "/"
        return str.replace(reSimple, "\\$&");
      }
      // Escaping "-" allows the result to be inserted into a character class.
      // Escaping "/" allow the result to be used in a JS regex literal.
      return str.replace(reStandard, "\\$&");
    };
    return fn(...args);
  },

  getNormalizedUrl(urlObj) {
    const u = urlObj.username;
    const p = urlObj.password;
    const t = urlObj.port;
    return urlObj.protocol + '//' + 
        (u ? u + (p ? ':' + p : '') + '@' : '') + 

        // URL.hostname is not punycoded in some old browsers (e.g. Firefox 52)
        punycode.toASCII(urlObj.hostname) + 

        (t ? ':' + t : '') + 
        urlObj.pathname + urlObj.search + urlObj.hash;
  },

  getLines(...args) {
    const reSplitter = /\n|\r\n?/;
    const fn = this.getLines = (str) => {
      return (str || "").split(reSplitter);
    };
    return fn(...args);
  },

  versionCompare(v1, v2) {
    const v1parts = v1.split('.');
    const v2parts = v2.split('.');

    for (let i = 0; i < v1parts.length; ++i) {
      if (typeof v2parts[i] === "undefined") {
        return 1;
      }

      let n1 = parseInt(v1parts[i], 10);
      let n2 = parseInt(v2parts[i], 10);

      if (n1 > n2) {
        return 1;
      } else if (n1 < n2) {
        return -1;
      }
    }

    if (v1parts.length < v2parts.length) {
      return -1;
    }

    return 0;
  },

  doctypeToString(doctype) {
    if (!doctype) { return ""; }
    let ret = "<!DOCTYPE " + doctype.name;
    if (doctype.publicId) { ret += ' PUBLIC "' + doctype.publicId + '"'; }
    if (doctype.systemId) { ret += ' "'        + doctype.systemId + '"'; }
    ret += ">\n";
    return ret;
  },

  readFileAsDocument(blob) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.responseType = "document";
      xhr.onload = () => { resolve(xhr.response); }
      xhr.onerror = () => { reject(new Error("Network request failed.")); }
      xhr.open("GET", URL.createObjectURL(blob), true);
      xhr.send();
    });
  },

  getBlockedPageUrl(url, blockType = 1, inFrame = false) {
    url = utils.getNormalizedUrl(new URL(url));
    const redirectUrl = `${browser.runtime.getURL('blocked.html')}?to=${encodeURIComponent(url)}&type=${blockType}`;

    // A frame may be too small to show full description about blocking.
    // Display a link for opening in a new tab instead.
    if (inFrame) {
      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body>
<img src="${utils.escapeHtml(browser.runtime.getURL("img/content-farm-marker.svg"))}" alt="" style="width: 1em;"><a href="${utils.escapeHtml(redirectUrl, false)}" target="_blank">${utils.lang("viewBlockedFrame")}</a>
</body>
</html>
`;
      const dataUrl = 'data:text/html;charset=UTF-8,' + encodeURIComponent(html);
      return dataUrl;
    }

    return redirectUrl;
  },

  back() {
    if (history.length > 1) {
      history.go(-1);
      return;
    }

    return browser.tabs.getCurrent()
      .then((tab) => {
        return browser.runtime.sendMessage({
          cmd: 'closeTab',
          args: {tabId: tab.id},
        });
      });
  },
};
