// Cloudflare Pages Function: 接收后台修改，提交到 GitHub
// POST /api/commit  body: { file: "data/products.json", content: [...], message: "update products" }
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

  // 二次校验：管理员密码
  const expectedPwd = env.ADMIN_PWD;
  if (expectedPwd && password !== expectedPwd) {
    return json({ ok: false, error: 'password mismatch' }, 403);
  }

  // 限制只允许提交 data/ 下的 JSON
  if (!/^data\/[a-zA-Z0-9_\-]+\.json$/.test(file)) {
    return json({ ok: false, error: 'file must match data/*.json' }, 400);
  }

  // content 已经是字符串
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

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

  // 2) 提交
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
        content: btoa(unescape(encodeURIComponent(contentStr))),
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
