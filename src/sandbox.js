document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  const frame = document.querySelector('#viewer');
  const loading = document.querySelector('#loading');

  const url = new URL(location.href).searchParams.get('src');

  fetch(url, {credentials: 'include'}).then((response) => {
    return response.blob();
  }).then((blob) => {
    return utils.readFileAsDocument(blob).then((doc) => {
      if (!doc) { return blob; }

      const headElem = doc.querySelector('head');

      // respect original base but redirect links to parent frame
      Array.prototype.forEach.call(doc.querySelectorAll('base'), (elem) => {
        elem.target = '_parent';
      });

      // add base
      const baseElem = doc.createElement('base');
      baseElem.href = url;
      baseElem.target = '_parent';
      headElem.insertBefore(baseElem, headElem.firstChild);

      // remove original meta charset and content security policy
      Array.prototype.forEach.call(doc.querySelectorAll('meta'), (elem) => {
        if (elem.hasAttribute("charset")) {
          elem.remove();
        } else if (elem.hasAttribute("http-equiv") && elem.hasAttribute("content")) {
          const httpEquiv = elem.getAttribute("http-equiv").toLowerCase();
          if (httpEquiv === "content-type" || httpEquiv === "content-security-policy") {
            elem.remove();
          }
        }
      });

      // add content security policy to block offensive contents
      // the iframe cannot be loaded without "frame-src blob:"
      const u = new URL(url);
      const host = punycode.toASCII(u.host);
      const hostSubdomains = "*." + host.replace(/^www[.]/, '');
      const hostSources = `http://${host} https://${host} http://${hostSubdomains} https://${hostSubdomains}`;
      const metaCspElem = doc.createElement("meta");
      metaCspElem.setAttribute("http-equiv", "Content-Security-Policy");
      metaCspElem.setAttribute("content", `img-src ${hostSources} data:; media-src ${hostSources} data:; frame-src 'self' blob:; object-src 'none'; script-src 'none';`);
      headElem.insertBefore(metaCspElem, headElem.firstChild);

      // add meta charset to force UTF-8 encoding
      const metaCharsetElem = doc.createElement("meta");
      metaCharsetElem.setAttribute("charset", "UTF-8");
      headElem.insertBefore(metaCharsetElem, headElem.firstChild);

      // pass document title to top frame
      if (doc.title) { document.title = doc.title; }

      const html = utils.doctypeToString(doc.doctype) + doc.documentElement.outerHTML;
      return new Blob([html], {type: 'text/html'});
    });
  }).then((blob) => {
    const blobUrl = URL.createObjectURL(blob) + new URL(url).hash;
    const parent = frame.parentNode;
    const next = frame.nextSibling;
    parent.removeChild(frame);
    frame.src = blobUrl;
    parent.insertBefore(frame, next);
  }).catch((ex) => {
    console.error(ex);
  }).then(() => {
    loading.style.display = "none";
    frame.style.display = "block";
  });
});
