// Cloudflare Pages Function: 接收后台修改，提交到 GitHub
// POST /api/commit  body: { file: "data/products.json", content: "JSON string or base64", contentEncoding?: "base64", message: "update", password?: "..." }
//
// 环境变量（在 Cloudflare Pages 控制台配置）：
//   GITHUB_TOKEN  - Personal Access Token，Contents: Read and write
//   GITHUB_REPO   - 仓库名，例如 MuoXuanSHI/unicom-wenchuang
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

  // 二次校验：管理员密码（如果配置了的话）
  const expectedPwd = env.ADMIN_PWD;
  if (expectedPwd && password !== expectedPwd) {
    return json({ ok: false, error: 'password mismatch' }, 403);
  }

  // 限制只允许提交 data/ 下的 JSON
  if (!/^data\/[a-zA-Z0-9_\-]+\.json$/.test(file)) {
    return json({ ok: false, error: 'file must match data/*.json' }, 400);
  }

  // content 默认是浏览器已经 JSON.stringify 好的字符串；如果 contentEncoding==='base64'，则是已经编码好的 base64
  const isBase64 = body.contentEncoding === 'base64';
  const contentStr = (typeof content === 'string' && !isBase64) ? content : JSON.stringify(content, null, 2);

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

  // 2) base64 编码：如果浏览器已经传了 base64，直接复用，避免 Worker CPU 超时
  let base64 = '';
  if (isBase64 && typeof content === 'string') {
    base64 = content;
  } else {
    try {
      base64 = utf8ToBase64(contentStr);
    } catch (e) {
      return json({ ok: false, error: 'base64 encode failed: ' + e.message }, 500);
    }
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

// 兼容的 UTF-8 → base64，对大字符串也稳定
function utf8ToBase64(str) {
  // 在 Workers 环境中使用 TextEncoder + 手动 base64
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const len = bytes.length;
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
