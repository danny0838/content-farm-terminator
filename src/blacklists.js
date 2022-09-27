async function init(event) {
  utils.loadLanguages(document);
  const blacklist = await browser.runtime.sendMessage({
    cmd: 'getMergedBlacklist',
  });
  document.body.textContent = blacklist;
}

document.addEventListener('DOMContentLoaded', init);
