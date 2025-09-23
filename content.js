(function() {
  function extractFromNextData() {
    try {
      const el = document.querySelector('#__NEXT_DATA__');
      if (!el) return null;
      const data = JSON.parse(el.textContent);
      const q = data?.props?.pageProps?.dehydratedState?.queries?.find(q =>
        q?.state?.data?.questionId && q?.state?.data?.title
      )?.state?.data;
      if (!q) return null;
      return {
        problemId: q.questionId,
        title: q.title,
        difficulty: q.difficulty,
        topics: (q.topicTags || []).map(t => t.name)
      };
    } catch { return null; }
  }

  const info = extractFromNextData() || {};
  window.postMessage({ __LC_INFO__: info }, "*");

  const code = `
    (function(){
      try{
        const models = window.monaco?.editor?.getModels?.();
        const val = models && models.length ? models[0].getValue() : '';
        window.postMessage({__LC_CODE__: val}, '*');
      }catch(e){ window.postMessage({__LC_CODE__:'', __LC_ERR__: String(e)}, '*'); }
    })();`;
  const s = document.createElement('script'); s.textContent = code;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
})();
