// Cloudflare Pages Function: 接收后台修改，提交到 GitHub
// POST /api/commit
//   body: { file: "data/products.json", content: "JSON string or base64", contentEncoding?: "base64", message: "update", password?: "..." }
//
// 行为：
//   1. 浏览器端会先把 JSON 字符串 base64 编码（contentEncoding: 'base64'），
//      Worker 直接把 content 转发给 GitHub Contents API。
//   2. 为安全起见，Worker 会先 base64-decode 验证内容是否合法：
//        - 解码结果必须是合法 UTF-8
//        - 对 data/*.json，验证 JSON 解析成功
//      任何异常一律拒绝提交，返回明确错误。
//   3. 兜底：如果是 raw string（没有 contentEncoding），Worker 端用 TextEncoder + btoa 编码。
//
// 环境变量（在 Cloudflare Pages 配置）：
//   GITHUB_TOKEN  - Personal Access Token，Contents: Read and write
//   ADMIN_PWD     - 管理员密码（可选，用于二次校验）

const REPO_DEFAULT = 'MuoXuanSHI/unicom-wenchuang';
const BRANCH_DEFAULT = 'main';

export async function onRequestPost({ request, env }) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO || REPO_DEFAULT;
  const branch = env.GITHUB_BRANCH || BRANCH_DEFAULT;

  if (!token) {
    return json({ ok: false, error: 'GITHUB_TOKEN not configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'invalid json body' }, 400);
  }

  const { file, content, message, password } = body;
  if (!file || typeof content === 'undefined' || !message) {
    return json({ ok: false, error: 'missing field: file/content/message' }, 400);
  }

  // 二次校验
  const expectedPwd = env.ADMIN_PWD;
  if (expectedPwd && password !== expectedPwd) {
    return json({ ok: false, error: 'password mismatch' }, 403);
  }

  // 限制只允许提交 data/ 下的 JSON
  if (!/^data\/[a-zA-Z0-9_\-]+\.json$/.test(file)) {
    return json({ ok: false, error: 'file must match data/*.json' }, 400);
  }

  // 确定原始内容字符串
  const isBase64 = body.contentEncoding === 'base64';
  let contentStr = '';
  if (isBase64 && typeof content === 'string') {
    // 浏览器已经 base64 编码，Worker 端解码验证
    const bytes = safeBase64Decode(content);
    if (!bytes) {
      return json({ ok: false, error: 'invalid base64 content' }, 400);
    }
    if (!isMostlyPrintableUTF8(bytes)) {
      return json({ ok: false, error: 'decoded content not valid UTF-8 text' }, 400);
    }
    try {
      contentStr = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return json({ ok: false, error: 'UTF-8 decode failed: ' + e.message }, 400);
    }
  } else {
    // 兜底：直接当字符串处理
    contentStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  }

  // data/*.json 必须能解析为合法 JSON（防止错误 base64 写入不可读内容）
  if (file.endsWith('.json')) {
    try {
      JSON.parse(contentStr);
    } catch (e) {
      return json({ ok: false, error: 'content is not valid JSON: ' + e.message }, 400);
    }
  }

  // 长度上限：3MB（防滥用）
  if (contentStr.length > 3 * 1024 * 1024) {
    return json({ ok: false, error: 'content too large (max 3MB)' }, 413);
  }

  // 1) 读取当前文件的 sha
  const getRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(file)}?ref=${branch}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'unicom-wenchuang-pages-fn',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  );

  let sha = null;
  if (getRes.ok) {
    const getData = await getRes.json();
    sha = getData.sha;
  } else if (getRes.status !== 404) {
    const errText = await getRes.text();
    return json({ ok: false, error: `read file failed: ${getRes.status} ${errText}` }, 500);
  }

  // 2) base64 编码：现在直接对 contentStr（已验证）编码
  let base64 = '';
  try {
    base64 = utf8ToBase64(contentStr);
  } catch (e) {
    return json({ ok: false, error: 'base64 encode failed: ' + e.message }, 500);
  }

  // 3) 提交
  const putRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(file)}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'unicom-wenchuang-pages-fn',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        message: message,
        content: base64,
        branch: branch,
        sha: sha
      })
    }
  );

  const putText = await putRes.text();
  if (!putRes.ok) {
    return json({ ok: false, error: `commit failed: ${putRes.status} ${putText}` }, 500);
  }

  const putData = JSON.parse(putText);
  return json({
    ok: true,
    sha: putData.content && putData.content.sha,
    commit: putData.commit && putData.commit.sha,
    html_url: putData.content && putData.content.html_url
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// Worker 端 UTF-8 → base64，分块避免大字符串
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const len = bytes.length;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// 安全 base64 解码
function safeBase64Decode(s) {
  try {
    const clean = String(s).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(clean)) return null;
    if (clean.length % 4 !== 0) return null;
    const binary = atob(clean);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (e) {
    return null;
  }
}

// 检查解码后的字节是否大致是合法 UTF-8 文本
function isMostlyPrintableUTF8(bytes) {
  const total = bytes.length;
  if (total === 0) return false;
  let bad = 0;
  for (let i = 0; i < total; i++) {
    if (bytes[i] === 0x00) bad++;
  }
  if (bad / total > 0.5) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch (e) {
    return false;
  }
}
