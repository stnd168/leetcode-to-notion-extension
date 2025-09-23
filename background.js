// background.js — MV3 service worker

// ---------- Helpers ----------
// （429/5xx 重試，支援 Retry-After）
async function apiFetch(url, opts = {}, { retries = 3, retryDelay = 800 } = {}) {
  for (let i = 0; ; i++) {
    const resp = await fetch(url, opts);
    if (resp.ok) return resp;
    const status = resp.status;
    if (i >= retries || ![429, 500, 502, 503, 504].includes(status)) return resp;
    let delay = retryDelay * Math.pow(2, i); 
    const ra = resp.headers.get("retry-after");
    if (ra) {
      const sec = Number(ra);
      if (!Number.isNaN(sec) && sec > 0) delay = sec * 1000;
    }
    await new Promise(r => setTimeout(r, delay));
  }
}

function postProgress(portOrSender, msg) {
  try {
    // chrome.runtime.sendMessage 廣播回 popup
    chrome.runtime.sendMessage({ __progress: true, msg });
  } catch {}
}

function splitChunks(s, n = 1800) {
  if (!s) return [];
  return s.match(new RegExp(`.{1,${n}}`, 'gs')) || [];
}

function pageUrlFromNotionCreateResp(data) {
  if (data?.url) return data.url;
  if (data?.id) return `https://www.notion.so/${data.id.replace(/-/g, '')}`;
  return '';
}

function normalizeLanguage(s) {
  if (!s) return 'plain text';
  const x = String(s).trim().toLowerCase();
  const map = {
    cpp: 'c++', 'c++': 'c++',
    csharp: 'c#', cs: 'c#', 'c#': 'c#',
    py: 'python', python3: 'python',
    js: 'javascript', ts: 'typescript',
    text: 'plain text', plaintext: 'plain text',
    sh: 'bash', shell: 'shell', yml: 'yaml', htm: 'html'
  };
  return map[x] || s;
}

function normalizeDifficulty(d) {
  if (!d) return undefined;
  const m = String(d).toLowerCase();
  if (m === 'easy') return 'Easy';
  if (m === 'medium') return 'Medium';
  if (m === 'hard') return 'Hard';
  return d;
}

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absolutize(src) {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('/')) return 'https://leetcode.com' + src;
  return 'https://leetcode.com/' + src.replace(/^\/+/, '');
}

// HTML -> Notion blocks (headings/para/list/code/img)
function htmlToNotionBlocks(html) {
  if (!html) return [];
  let s = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n');

  // Extract code blocks
  const codeBlocks = [];
  s = s.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, inner) => {
    codeBlocks.push(decodeEntities(inner).trim());
    return `\n\n__CODE_BLOCK_PLACEHOLDER__\n\n`;
  });

  // Extract images
  const imgBlocks = [];
  s = s.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (_, src) => {
    imgBlocks.push(absolutize(src));
    return `\n\n__IMG_PLACEHOLDER__\n\n`;
  });

  // Lists boundaries
  s = s.replace(/<\/?(ul|ol)>/gi, '\n');

  // Strip remaining tags, then decode entities
  s = s.replace(/<\/?[^>]+>/g, '');
  s = decodeEntities(s);

  const lines = s.split(/\n+/).map(t => t.trim()).filter(Boolean);
  const blocks = [{
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Problem' } }] }
  }];

  for (const line of lines) {
    if (line === '__CODE_BLOCK_PLACEHOLDER__') {
      const code = codeBlocks.shift() || '';
      blocks.push({
        object: 'block',
        type: 'code',
        code: { language: 'plain text', rich_text: [{ type: 'text', text: { content: code } }] }
      });
      continue;
    }
    if (line === '__IMG_PLACEHOLDER__') {
      const src = imgBlocks.shift();
      if (src) {
        blocks.push({
          object: 'block',
          type: 'image',
          image: { type: 'external', external: { url: src } }
        });
      }
      continue;
    }
    if (/^(\-|\*)\s+/.test(line)) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.replace(/^(\-|\*)\s+/, '') } }] }
      });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\.\s+/, '') } }] }
      });
      continue;
    }
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: line } }] }
    });
  }

  return blocks.slice(0, 90);
}

async function fetchQuestion(slug) {
  const resp = await apiFetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query getQuestionDetail($titleSlug: String!) {
          question(titleSlug: $titleSlug) {
            questionId
            title
            difficulty
            topicTags { name }
            content
          }
        }`,
      variables: { titleSlug: slug }
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data));
  return data?.data?.question || null;
}

function parseTimesCorrect(page) {
  try {
    const prop = page?.properties?.['Times/Correct'];
    if (!prop) return { times: 0, correct: 0 };
    if (prop.type === 'rich_text') {
      const txt = (prop.rich_text?.[0]?.plain_text || '').trim();
      const m = txt.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (m) return { times: Number(m[1]), correct: Number(m[2]) };
    }
  } catch {}
  return { times: 0, correct: 0 };
}

async function deleteAllChildren(pageId, token) {
  let cursor;
  while (true) {
    const q = await apiFetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' }
    });
    const data = await q.json();
    const children = data?.results || [];
    if (!children.length) break;
    for (const b of children) {
      await apiFetch(`https://api.notion.com/v1/blocks/${b.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
        body: JSON.stringify({ archived: true })
      });
    }
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
}

async function appendChildren(pageId, token, blocks) {
  if (!blocks.length) return;
  for (let i = 0; i < blocks.length; i += 90) {
    const chunk = blocks.slice(i, i + 90);
    await apiFetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify({ children: chunk })
    });
  }
}

async function findExistingPage(dbid, token, { problemId, url }) {
  // Try by Problem
  if (problemId != null) {
    const r = await apiFetch(`https://api.notion.com/v1/databases/${dbid}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify({ filter: { property: 'Problem', number: { equals: Number(problemId) } }, page_size: 1 })
    });
    const d = await r.json();
    if (r.ok && d.results?.length) return { exists: true, page: d.results[0] };
  }
  // Try by Link
  if (url) {
    const r = await apiFetch(`https://api.notion.com/v1/databases/${dbid}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify({ filter: { property: 'Link', url: { equals: url } }, page_size: 1 })
    });
    const d = await r.json();
    if (r.ok && d.results?.length) return { exists: true, page: d.results[0] };
  }
  return { exists: false, page: null };
}

// Review (Status) helpers
async function getStatusOptions(dbid, token) {
  const r = await apiFetch(`https://api.notion.com/v1/databases/${dbid}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' }
  });
  const d = await r.json();
  const prop = d?.properties?.['review'];
  return prop?.status?.options?.map(o => o.name) || [];
}
function normalizeStatusName(name, options) {
  if (!name) return null;
  const desired = String(name).replace(/[’]/g, "'"); // curly -> straight
  if (options.includes(desired)) return desired;
  const ci = options.find(o => o.toLowerCase() === desired.toLowerCase());
  if (ci) return ci;
  if (options.includes('need review')) return 'need review';
  return options[0] || null;
}


// ---------- Message Listener ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'saveToNotion') {
    (async () => {
      try {
        const { token, dbid } = await chrome.storage.sync.get(['token', 'dbid']);
        if (!token || !dbid) { sendResponse({ ok: false, error: 'Notion Token/Database ID 未設定' }); return; }

        const p = msg.payload || {};
        const today = new Date().toISOString().slice(0, 10);

        // 抓 LeetCode 題目描述與 metadata 
        let descBlocks = [];
        if (p.slug) {
          try {
            const q = await fetchQuestion(p.slug);
            if (q) {
              if (p.problemId == null && q.questionId != null) p.problemId = Number(q.questionId);
              if (!p.title && q.title) p.title = q.title;
              if (!p.difficulty && q.difficulty) p.difficulty = normalizeDifficulty(q.difficulty);
              if ((!Array.isArray(p.topics) || !p.topics.length) && Array.isArray(q.topicTags)) {
                p.topics = q.topicTags.map(t => t.name).filter(Boolean);
              }
              if (q.content) descBlocks = htmlToNotionBlocks(q.content);
            }
          } catch {}
        }

        // Code blocks
        const codeBlocks = [];
        if (p.code) {
          codeBlocks.push({
            object: 'block',
            type: 'heading_2',
            heading_2: { rich_text: [{ type: 'text', text: { content: 'Code' } }] }
          });
          for (const c of splitChunks(p.code)) {
            codeBlocks.push({
              object: 'block',
              type: 'code',
              code: { language: normalizeLanguage(p.language), rich_text: [{ type: 'text', text: { content: c } }] }
            });
          }
        }
        const children = [...descBlocks, ...codeBlocks].slice(0, 95);

        // 判斷是否已存在 Notion 頁面 
        const { exists, page } = await findExistingPage(dbid, token, { problemId: p.problemId, url: p.url });

        // Times/Correct 累積
        let times = 0, correct = 0;
        if (exists) {
          const tc = parseTimesCorrect(page);
          times = tc.times; correct = tc.correct;
        }
        times += 1;
        if (p.correct) correct += 1;
        const timesCorrectText = `${times}/${correct}`;

        // Review (Status) safe value
        const statusOptions = await getStatusOptions(dbid, token);
        const safeReview = normalizeStatusName(p.reviewStatus, statusOptions);

        // 根據 review 狀態自動決定 Next Date
        let nextDate = null;
        if (safeReview) {
          const base = new Date();
          if (safeReview.toLowerCase() === 'done') {
            base.setMonth(base.getMonth() + 1);
            nextDate = base.toISOString().slice(0, 10);
          } else if (safeReview.toLowerCase() === 'need review') {
            base.setDate(base.getDate() + 7);
            nextDate = base.toISOString().slice(0, 10);
          } else if (safeReview.toLowerCase() === "don't understand") {
            base.setDate(base.getDate() + 2);
            nextDate = base.toISOString().slice(0, 10);
          }
        }

        // Build properties
        const baseProps = {
          'Content': { title: [{ text: { content: (p.title || 'LeetCode Problem').trim() } }] },
          'Problem': p.problemId != null ? { number: Number(p.problemId) } : undefined,
          'Link': p.url ? { url: p.url } : undefined,
          'Difficulty': p.difficulty ? { select: { name: p.difficulty } } : undefined,
          'Topic': { multi_select: (Array.isArray(p.topics) ? p.topics : []).map(t => ({ name: t })) },
          'Importance': p.importance ? { select: { name: p.importance } } : undefined,
          ...(safeReview ? { 'review': { status: { name: safeReview } } } : {}),
          'Last Date': { date: { start: today } },
          ...(nextDate ? { 'Next Date': { date: { start: nextDate } } } : {}) // Next Date
        };
        Object.keys(baseProps).forEach(k => baseProps[k] === undefined && delete baseProps[k]);
        const propsWithTimes = {
          ...baseProps,
          'Times/Correct': { rich_text: [{ type: 'text', text: { content: timesCorrectText } }] }
        };

        if (!exists) {
          const createResp = await apiFetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
            body: JSON.stringify({ parent: { database_id: dbid }, properties: propsWithTimes, children })
          });
          const data = await createResp.json();
          if (!createResp.ok) { sendResponse({ ok: false, error: data }); return; }
          sendResponse({ ok: true, notion: data, pageUrl: pageUrlFromNotionCreateResp(data) });
          return;
        }

        // Update existing
        const pageId = page.id;
        const updateResp = await apiFetch(`https://api.notion.com/v1/pages/${pageId}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
          body: JSON.stringify({ properties: propsWithTimes })
        });
        const updateData = await updateResp.json();
        if (!updateResp.ok) { sendResponse({ ok: false, error: updateData }); return; }

        await deleteAllChildren(pageId, token);
        if (children.length) await appendChildren(pageId, token, children);

        sendResponse({ ok: true, notion: updateData, pageUrl: pageUrlFromNotionCreateResp(updateData) });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep channel open
  }

  if (msg.action === 'fetchLeetCodeMeta') {
    (async () => {
      try {
        const slug = (msg.slug || '').trim();
        if (!slug) { sendResponse({ ok: false, error: 'missing slug' }); return; }
        const q = await fetchQuestion(slug);
        if (!q) { sendResponse({ ok: false, error: 'no question' }); return; }
        sendResponse({
          ok: true,
          data: {
            problemId: q.questionId,
            title: q.title,
            difficulty: normalizeDifficulty(q.difficulty),
            topics: (q.topicTags || []).map(t => t.name)
          }
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "keepalive") {
    port.onMessage.addListener((m) => {
      // 收到 ping，保持連線
    });
  }
});
