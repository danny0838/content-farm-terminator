document.addEventListener('DOMContentLoaded', (event) => {
  utils.loadLanguages(document);

  var url = new URL(location.href).searchParams.get('src');

  fetch(url, {credentials: 'include'}).then((response) => {
    return response.blob();
  }).then((blob) => {
    return utils.readFileAsDocument(blob);
  }).then((doc) => {
    var headElem = doc.querySelector('head');

    // respect original base but redirect links to parent frame
    Array.prototype.forEach.call(doc.querySelectorAll('base'), (elem) => {
      elem.target = '_parent';
    });

    // add base
    var baseElem = doc.createElement('base');
    baseElem.href = url;
    baseElem.target = '_parent';
    headElem.insertBefore(baseElem, headElem.firstChild);

    // remove original meta charset and content security policy
    Array.prototype.forEach.call(doc.querySelectorAll('meta'), (elem) => {
      if (elem.hasAttribute("charset")) {
        elem.remove();
      } else if (elem.hasAttribute("http-equiv") && elem.hasAttribute("content")) {
        let httpEquiv = elem.getAttribute("http-equiv").toLowerCase();
        if (httpEquiv === "content-type" || httpEquiv === "content-security-policy") {
          elem.remove();
        }
      }
    });

    // add content security policy to block offensive contents
    var metaCspElem = doc.createElement("meta");
    metaCspElem.setAttribute("http-equiv", "Content-Security-Policy");
    metaCspElem.setAttribute("content", "img-src data:; media-src data:; object-src 'none'; frame-src blob:; script-src 'none';");
    headElem.insertBefore(metaCspElem, headElem.firstChild);

    // add meta charset to force UTF-8 encoding
    var metaCharsetElem = doc.createElement("meta");
    metaCharsetElem.setAttribute("charset", "UTF-8");
    headElem.insertBefore(metaCharsetElem, headElem.firstChild);

    // pass document title to top frame
    document.title = doc.title;

    return utils.doctypeToString(doc.doctype) + doc.documentElement.outerHTML;
  }).then((text) => {
    let blob = new Blob([text], {type: 'text/html'});
    let blobUrl = URL.createObjectURL(blob);
    let frame = document.querySelector('#viewer');
    let parent = frame.parentNode;
    let next = frame.nextSibling;
    parent.removeChild(frame);
    frame.src = blobUrl;
    parent.insertBefore(frame, next);
  });
});
