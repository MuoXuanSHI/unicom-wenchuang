/* ====== 全局数据 ====== */
let allProducts = [];
let top100Data = [];
let newData = [];
let suitsData = {};
let eventsData = [];
let adminAuthed = false;
const ADMIN_PWD = 'unicom2026';
let pageHistory = [];
let currentWarehouse = 'all';
let priceFilterMin = null;
let priceFilterMax = null;
let currentHotTab = 'top100';

/* ====== 同步到 GitHub 工具 ====== */
// 通过 Cloudflare Pages Function 提交修改到 GitHub
// 返回 { ok, error?, commit? }
async function commitToGitHub(file, dataObj, message) {
  try {
    var contentStr = typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj, null, 2);
    // 在浏览器端完成 base64 编码，减少 Cloudflare Worker CPU 消耗
    var contentBase64 = utf8ToBase64Browser(contentStr);
    // 用 AbortController 设置 30 秒超时
    var controller = new AbortController();
    var timeoutId = setTimeout(function(){ controller.abort(); }, 30000);
    var res = await fetch('/api/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: file,
        content: contentBase64,
        contentEncoding: 'base64',
        message: message,
        password: ADMIN_PWD
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    var text = await res.text();
    var r;
    try { r = JSON.parse(text); } catch(e) { r = { error: text }; }
    if (!res.ok || !r.ok) {
      return { ok: false, error: (r && r.error) || ('HTTP ' + res.status + ' ' + text.slice(0,200)) };
    }
    return { ok: true, commit: r.commit };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return { ok: false, error: '请求超时（30秒），请稍后重试。' };
    }
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// 浏览器端 UTF-8 字符串转 base64（用 TextEncoder，避免 unescape 已废弃的坑）
function utf8ToBase64Browser(str) {
  var bytes = new TextEncoder().encode(str);
  var binary = '';
  var chunkSize = 0x8000;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.prototype.slice.call(chunk));
  }
  return btoa(binary);
}

// 拉取最新的 JSON 数据（绕过本地缓存），用于编辑/删除前重新同步基准
async function fetchFreshProducts() {
  var r = await fetch('../data/products.json?_=' + Date.now());
  return r.ok ? r.json() : null;
}
async function fetchFreshEvents() {
  var r = await fetch('../data/events.json?_=' + Date.now());
  return r.ok ? r.json() : null;
}

/* ====== 分页加载状态 ====== */
var PAGE_SIZE = 24;            // 每页加载的产品数量（适配2/3/4列网格）
var listVisibleCount = 0;      // 产品列表已渲染数量
var listFilteredData = [];     // 产品列表当前筛选结果
var invVisibleCount = 0;       // 库存列表已渲染数量
var invFilteredData = [];      // 库存列表当前筛选结果
var searchDebounceTimer = null; // 搜索防抖计时器
var listSentinel = null;       // 列表滚动哨兵元素
var invSentinel = null;        // 库存滚动哨兵元素
var listObserver = null;       // 列表无限滚动观察器
var invObserver = null;        // 库存无限滚动观察器

/* ====== 初始化 ====== */
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  loadAuxData();
  renderContacts();
  initTopNavScroll();
});

/* ====== 数据加载 ====== */
async function loadData() {
  try {
    const res = await fetch('../data/products.json?_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    allProducts = await res.json();
    // 产品数据就绪后立即渲染首页各组件（NIOLife 截图组件不依赖 newData/suitsData）
    renderNewProducts();
    renderRoundGrid();
    renderBannerCarousel();
    renderDuoCards();
    /* 支持 URL 参数直接进分类页：?cat=办公场景 */
    handleUrlParams();
  } catch (e) {
    console.error('加载数据失败:', e);
    document.getElementById('newProductsList').innerHTML = '<p style="padding:20px;text-align:center;color:#999;">加载失败，请刷新重试</p>';
  }
}

/* 处理 URL 参数进入分类页 */
function handleUrlParams() {
  var params = new URLSearchParams(window.location.search);
  var cat = params.get('cat');
  if (cat) {
    setTimeout(function(){ goCategory(cat); }, 100);
  }
}

async function loadAuxData() {
  try {
    const [r1, r2, r3, r4] = await Promise.all([
      fetch('../data/top100_hot.json').then(function(r){return r.ok?r.json():[]}),
      fetch('../data/new_products.json').then(function(r){return r.ok?r.json():[]}),
      fetch('../data/suits.json').then(function(r){return r.ok?r.json():{}}),
      fetch('../data/events.json').then(function(r){return r.ok?r.json():[]})
    ]);
    top100Data = Array.isArray(r1) ? r1 : [];
    newData = Array.isArray(r2) ? r2 : [];
    suitsData = r3 && typeof r3 === 'object' ? r3 : {};
    // 现在事件直接同步到 GitHub data/events.json，不再合并本地 localStorage pending events，
    // 避免刷新后旧本地缓存把已删除/已编辑的内容又显示回来。
    eventsData = Array.isArray(r4) ? r4 : [];
    eventsData.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    // refresh home page new section now that newData is loaded
    if (allProducts && allProducts.length) {
      renderNewProducts();
      renderRoundGrid();
      renderBannerCarousel();
      renderDuoCards();
    }
    renderHotRecommend();
    renderSuits();
  } catch (e) {
    console.error('加载热力榜数据失败:', e);
  }
}

/* ====== 页面导航 ====== */
function goHome() {
  brandKeyword = '';
  showPage('page-home');
  updateNav('home');
}

/* 品牌矩阵筛选关键词（NIOLife 式子品牌页） */
var brandKeyword = '';

function goCategory(category) {
  brandKeyword = '';
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-list');
  updateNav('list');
  const sel = document.getElementById('filterCategory');
  if (sel) sel.value = category;
  subCatKeyword = '';
  applyFilter();
  renderCatHero(category);
  renderSubCategories(category);
  const titleEl = document.querySelector('.page-back-title');
  var cat = CATEGORY_LIST.find(function(c){ return c.value === category; });
  if (titleEl) titleEl.textContent = cat ? cat.label : (category || '全部好物');
}

/* 分类页顶部大图头（NIOLife 系列页：产品图模糊放大做背景） */
function renderCatHero(category) {
  var hero = document.getElementById('catHero');
  if (!hero) return;
  if (!category) { hero.style.display = 'none'; return; }
  var cat = CATEGORY_LIST.find(function(c){ return c.value === category; });
  if (!cat) { hero.style.display = 'none'; return; }
  var p = allProducts.find(function(x){ return x.category === category && x.images && x.images.length; });
  if (!p) { hero.style.display = 'none'; return; }
  var bg = document.getElementById('catHeroBg');
  bg.style.backgroundImage = 'url(' + imgUrl(p.images[0]) + ')';
  document.getElementById('catHeroEyebrow').textContent = 'UNICOM WENCHUANG';
  document.getElementById('catHeroTitle').textContent = cat.label;
  var cnt = allProducts.filter(function(x){ return x.category === category; }).length;
  document.getElementById('catHeroSub').textContent = cnt + ' 款精选好物';
  hero.style.display = 'block';
}

/* 从首页品牌矩阵进入，按 IP 关键词筛产品 */
function goBrand(kw) {
  brandKeyword = kw;
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-list');
  updateNav('list');
  const sel = document.getElementById('filterCategory');
  if (sel) sel.value = '';
  applyFilter();
  renderBrandHero(kw);
  const titleEl = document.querySelector('.page-back-title');
  if (titleEl) titleEl.textContent = kw;
}

/* 分类页子分类宫格（NIOLife 式：圆形图标 2 行排列） */
var subCatKeyword = '';
function renderSubCategories(category) {
  var bar = document.getElementById('subCatBar');
  var scroll = document.getElementById('subCatScroll');
  if (!bar || !scroll) return;
  subCatKeyword = '';
  var subs = SUB_CATEGORY_MAP[category];
  if (!subs || !subs.length) { bar.style.display = 'none'; return; }
  /* 独占匹配：每个产品只归到第一个命中的子分类，避免重叠计数 */
  var catProducts = allProducts.filter(function(p) { return p.category === category; });
  var used = new Set();
  var items = subs.map(function(s) {
    var matched = catProducts.filter(function(p) {
      var key = p.product_code_74 || (p.name || '') + '|' + (p.product_code_69 || '');
      if (used.has(key)) return false;
      return s.kws.some(function(k) { return (p.name||'').indexOf(k) >= 0; });
    });
    matched.forEach(function(p) {
      var key = p.product_code_74 || (p.name || '') + '|' + (p.product_code_69 || '');
      used.add(key);
    });
    var withImg = matched.find(function(p){ return p.images && p.images.length; });
    return { name: s.name, cnt: matched.length, img: withImg ? withImg.images[0] : null };
  })
  .filter(function(x) { return x.cnt > 0; })
  .sort(function(a, b) { return b.cnt - a.cnt; });  /* 产品多的排前面 */
  if (!items.length) { bar.style.display = 'none'; return; }
  /* 动态列数：1+有货子分类数（含"全部"），1-3 个时居中，4+ 时铺满 5 列 */
  var totalCount = items.length + 1;  /* +1 for 全部 */
  var cols = Math.min(Math.max(totalCount, 4), 5);
  scroll.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
  /* "全部"项显示分类代表图 */
  var allImg = findCategoryImage(category);
  var html = subCatItemHtml('全部', allImg, '', true);
  html += items.map(function(it) {
    return subCatItemHtml(it.name + '\n' + it.cnt + '款', it.img, it.name, false);
  }).join('');
  scroll.innerHTML = html;
  bar.style.display = 'block';
}

/* 计算分类下产品总数 */
function totalCountofCategory(category) {
  return allProducts.filter(function(p){ return p.category === category; }).length;
}
function subCatItemHtml(name, img, value, active) {
  return '<div class="sub-cat-item' + (active ? ' active' : '') + '" onclick="filterSubCat(this, \'' + value + '\')">' +
    '<div class="sub-cat-icon">' +
      (img ? '<img src="' + imgUrl(img) + '" loading="lazy" alt="' + name + '">' : '<span class="sub-cat-fallback">📦</span>') +
    '</div>' +
    '<div class="sub-cat-label">' + name + '</div>' +
  '</div>';
}
function filterSubCat(el, subName) {
  document.querySelectorAll('.sub-cat-item').forEach(function(x){ x.classList.remove('active'); });
  if (el) el.classList.add('active');
  subCatKeyword = subName;
  applyFilter();
}

/* ---- 分类页分段：新品推荐 + 热卖推荐(NIOLife 视频结构) ---- */
function renderListSections(category) {
  /* 新品分段 */
  var newCardWrap = document.getElementById('listNewGrid');
  var newSection = document.getElementById('listNewSection');
  if (newCardWrap && newSection) {
    var newList = allProducts.filter(function(p) {
      return p.category === category && p.is_new && p.images && p.images.length > 0;
    }).slice(0, 6);
    if (newList.length > 0) {
      newCardWrap.innerHTML = newList.map(function(p) {
        var info = parseProductName(p);
        var img = p.images && p.images[0] ? imgUrl(p.images[0]) : '';
        var imgHtml = img
          ? '<img src="' + img + '" alt="' + info.title + '" loading="lazy">'
          : '<div class="no-img-placeholder">暂无图片</div>';
        return '<div class="np-card" onclick="renderProductDetail(\'' + p.product_code_74 + '\')">' +
          '<div class="np-img-wrap">' + imgHtml + '<span class="np-badge np-badge-new">NEW</span></div>' +
          '<div class="np-body">' +
            '<div class="np-series">' + info.series + '</div>' +
            '<div class="np-title">' + info.title + '</div>' +
            (info.tagline ? '<div class="np-tagline">' + info.tagline + '</div>' : '') +
            '<div class="np-price">' +
              '<span class="np-price-now">¥' + (p.settlement_price || 0) + '</span>' +
              (p.retail_price ? '<span class="np-price-was">¥' + p.retail_price + '</span>' : '') +
            '</div>' +
            '<div class="np-code">' + p.product_code_74 + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
      newSection.style.display = 'block';
    } else {
      newSection.style.display = 'none';
    }
  }

  /* 热卖分段 */
  var hotCardWrap = document.getElementById('listHotGrid');
  var hotSection = document.getElementById('listHotSection');
  if (hotCardWrap && hotSection && typeof top100Data !== 'undefined' && top100Data.length > 0) {
    var hotList = top100Data.filter(function(p) {
      return p.category === category && p.images && p.images.length > 0;
    }).slice(0, 4);
    if (hotList.length > 0) {
      hotCardWrap.innerHTML = hotList.map(function(p, i) {
        var info = parseProductName(p);
        var img = p.images && p.images[0] ? imgUrl(p.images[0]) : '';
        var imgHtml = img
          ? '<img src="' + img + '" alt="' + info.title + '" loading="lazy">'
          : '<div class="no-img-placeholder">暂无图片</div>';
        var rankClass = i < 3 ? ' np-rank-top3' : '';
        return '<div class="np-card" onclick="renderProductDetail(\'' + p.product_code_74 + '\')">' +
          '<div class="np-img-wrap">' + imgHtml + '<span class="np-rank' + rankClass + '">热销榜 TOP ' + (i+1) + '</span></div>' +
          '<div class="np-body">' +
            '<div class="np-series">' + info.series + '</div>' +
            '<div class="np-title">' + info.title + '</div>' +
            '<div class="np-price">' +
              '<span class="np-price-now">¥' + (p.settlement_price || 0) + '</span>' +
              (p.retail_price ? '<span class="np-price-was">¥' + p.retail_price + '</span>' : '') +
            '</div>' +
            '<div class="np-code">' + p.product_code_74 + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
      hotSection.style.display = 'block';
    } else {
      hotSection.style.display = 'none';
    }
  }
}

/* 品牌页头图（NIOLife 子品牌页风格） */
function renderBrandHero(kw) {
  var hero = document.getElementById('catHero');
  if (!hero) return;
  var p = allProducts.find(function(x){ return (x.name||'').indexOf(kw) >= 0 && x.images && x.images.length; });
  if (!p) { hero.style.display = 'none'; return; }
  document.getElementById('catHeroBg').style.backgroundImage = 'url(' + imgUrl(p.images[0]) + ')';
  document.getElementById('catHeroEyebrow').textContent = 'UNICOM WENCHUANG · IP';
  document.getElementById('catHeroTitle').textContent = kw;
  var cnt = allProducts.filter(function(x){ return (x.name||'').indexOf(kw) >= 0; }).length;
  document.getElementById('catHeroSub').textContent = cnt + ' 款产品';
  hero.style.display = 'block';
}

function goInventory() {
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-inventory');
  updateNav('inventory');
  renderInventory();
}

function goCustom() {
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-custom');
  updateNav('custom');
}

function goContact() {
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-contact');
  updateNav('contact');
}

function goBack() {
  if (pageHistory.length > 0) {
    const prev = pageHistory.pop();
    showPage(prev.page);
    if (prev.page === 'page-home') updateNav('home');
    else if (prev.page === 'page-list') updateNav('list');
    else if (prev.page === 'page-inventory') updateNav('inventory');
    else if (prev.page === 'page-custom') updateNav('custom');
    else if (prev.page === 'page-contact') updateNav('contact');
  } else {
    goHome();
  }
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  window.scrollTo(0, 0);
}

function updateNav(activeType) {
  document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
  const navMap = {
    'home': 0, 'list': 1, 'hot': 2, 'events': 3,
    'detail': 1, 'suit': 1
  };
  const idx = navMap[activeType];
  if (idx !== undefined) {
    const items = document.querySelectorAll('.bottom-nav .nav-item');
    if (items[idx]) items[idx].classList.add('active');
  }
}

/* ============================================================
   NIOLife 截图风格 · 首页组件
   ------------------------------------------------------------
   参考 NIO App「惊喜」真实截图：
     ① Tab 分类导航（推荐/服饰/家居…）
     ② 圆形分类宫格（圆形产品图 + 短名称）
     ③ 大 Banner 轮播（全宽场景图 + 叠字）
     ④ 双列主题大卡（半宽图 + 叠字）
   ============================================================ */

/* 子分类映射：每个大分类拆成生活化子分类（NIOLife 分类页圆形宫格） */
var SUB_CATEGORY_MAP = {
  '办公场景': [
    { name: '书写文具', kws: ['签字笔', '中性笔', '马克笔', '笔套装', '圆珠笔', '钢笔', '荧光笔'] },
    { name: '笔记本册', kws: ['笔记本', '记事本', '便签', '画册', '手帐', '手账', '手札', '便签本'] },
    { name: '书签贺卡', kws: ['书签', '贺卡', '卡片', '明信片', '便签条', '标签'] },
    { name: '桌面好物', kws: ['鼠标垫', '杯垫', '凤尾夹', '台历', '日历', '笔筒', '名片盒', '收纳盒', '笔架'] },
    { name: '徽章配饰', kws: ['徽章', '胸针', '钥匙扣', '挂件', '吊坠', '卡扣'] },
    { name: '杯壶茶具', kws: ['杯', '壶', '泡茶', '马克杯', '保温杯', '水杯', '茶具'] },
    { name: '文具套装', kws: ['文具套装', '礼盒套装', '礼品套装', '学习用品', '办公用品', '组合'] },
    { name: '计算器', kws: ['计算器', '计算器机'] },
    { name: '印章印泥', kws: ['印章', '印泥', '印台'] },
    { name: 'U盘数码', kws: ['U盘', '优盘', '充电', '数据线', '数码'] },
    { name: '名片夹', kws: ['名片', '名片夹'] }
  ],
  '营销场景': [
    { name: '帆布袋包', kws: ['帆布袋', '帆布包', '手提袋', '无纺布袋', '手提纸袋', '编织袋', '购物袋', '环保袋', '纸袋', '文件袋', '包'] },
    { name: '挂件配饰', kws: ['挂件', '钥匙扣', '徽章', '胸针', '胸章', '吊坠', '卡套', '挂饰'] },
    { name: '冰箱贴', kws: ['冰箱贴', '磁力贴', '磁性贴'] },
    { name: '玩偶公仔', kws: ['玩偶', '公仔', '摆件', '吉祥物', '墩墩', '熊熊', '娃娃', '手办', '毛绒'] },
    { name: '杯壶饮水', kws: ['杯', '壶', '马克杯', '保温杯', '水杯', '泡茶', '水瓶', '吸管杯', '咖啡杯'] },
    { name: '拼图玩具', kws: ['拼图', '玩具', '魔方', '积木', '拼装'] },
    { name: '箱包皮具', kws: ['拉杆箱', '旅行箱', '箱包', '皮具', '钱包', '卡包', '手提包', '行李箱'] },
    { name: '运动装备', kws: ['运动', '背心', '球衣', '球服', '号码簿', '马拉松', '手环', '腕带'] },
    { name: '桌面收纳', kws: ['抽纸盒', '纸巾盒', '收纳盒', '笔筒', '整理盒'] },
    { name: '书签便签', kws: ['书签', '便签', '标签', '贴纸', '便条'] },
    { name: '明信片贺卡', kws: ['明信片', '贺卡', '卡片', '生日卡'] },
    { name: '红包春联', kws: ['红包', '春联', '福字', '对联', '窗花', '年画'] },
    { name: '日历台历', kws: ['日历', '台历', '月历', '年历', '黄历'] },
    { name: 'U盘数码', kws: ['U盘', '优盘', '充电宝', '数据线', '鼠标', '键盘', '充电', '移动硬盘'] },
    { name: '签字笔', kws: ['签字笔', '中性笔', '马克笔', '笔套装', '圆珠笔'] },
    { name: '卡套证件', kws: ['卡套', '工作证', '工牌', '胸牌', '证件'] },
    { name: '手机配件', kws: ['手机壳', '贴膜', '屏保', '手机支架', '手机'] },
    { name: '口罩卫生', kws: ['口罩', '湿巾', '纸巾', '酒精', '消毒'] },
    { name: '手帕毛巾', kws: ['手帕', '毛巾', '方巾', '丝巾', '浴巾'] },
    { name: 'u形枕靠垫', kws: ['U形枕', 'U型枕', '靠垫', '抱枕', '腰枕'] },
    { name: '雨衣伞具', kws: ['雨衣', '伞', '遮阳', '雨具'] },
    { name: '工牌皮套', kws: ['工牌', '皮套', '卡包'] },
    { name: '香薰香卡', kws: ['香薰', '香卡', '香囊', '香水', '香氛'] },
    { name: '摆件陈列', kws: ['摆件', '立牌', '陈列', '展示', '相框'] },
    { name: '糖果食品', kws: ['糖', '零食', '咖啡', '茶', '巧克力', '点心'] },
    { name: '奖牌奖章', kws: ['奖牌', '奖章', '勋章', '纪念章', '徽章'] }
  ],
  '商务场景': [
    { name: '商务礼盒', kws: ['礼盒', '套装', '伴手礼', '礼品盒'] },
    { name: '书写工具', kws: ['笔', '签字笔', '中性笔', '钢笔'] },
    { name: '笔记本册', kws: ['笔记本', '记事本', '手帐', '手账'] },
    { name: '杯壶茶具', kws: ['杯', '壶', '茶具', '保温杯'] },
    { name: '名片夹卡包', kws: ['名片', '卡包', '名片夹', '卡夹'] },
    { name: '皮具箱包', kws: ['皮具', '箱包', '公文包', '公文袋', '皮包', '钱包'] },
    { name: 'U盘数码', kws: ['U盘', '优盘', '充电', '数据线', '数码', '移动硬盘'] },
    { name: '商务配饰', kws: ['领带', '袖扣', '胸针', '皮带', '手表'] },
    { name: '文件夹袋', kws: ['文件夹', '文件袋', '档案袋', '资料袋'] },
    { name: '印章印泥', kws: ['印章', '印泥', '印台', '印鉴'] }
  ],
  '服装体系': [
    { name: 'T恤', kws: ['T恤', 'T-shirt'] },
    { name: 'POLO 衫', kws: ['POLO', 'polo'] },
    { name: '卫衣外套', kws: ['卫衣', '外套', '夹克', '冲锋衣', '棉服', '大衣'] },
    { name: '裤装', kws: ['裤', '长裤', '短裤', '牛仔裤', '运动裤'] },
    { name: '帽子', kws: ['帽', '棒球帽', '渔夫帽', '贝雷帽', '毛线帽'] },
    { name: '围巾丝巾', kws: ['围巾', '丝巾', '披肩', '方巾'] },
    { name: '袜子', kws: ['袜', '短袜', '长袜', '运动袜'] },
    { name: '手套', kws: ['手套', '指套'] },
    { name: '鞋子', kws: ['鞋', '运动鞋', '休闲鞋', '皮鞋', '拖鞋'] },
    { name: '箱包', kws: ['包', '双肩包', '手提包', '腰包', '斜挎包'] },
    { name: '运动装备', kws: ['运动', '健身', '瑜伽', '球服', '号码簿'] },
    { name: '儿童服饰', kws: ['儿童', '童装', '婴儿', '宝宝'] },
    { name: '内衣家居', kws: ['内衣', '家居服', '睡衣', '睡衣'] }
  ],
  'eSIM文创': [
    { name: 'eSIM 设备', kws: ['eSIM', 'sim', '智能设备', '终端'] },
    { name: '充电设备', kws: ['充电', '数据线', '充电器', '移动电源', '充电宝'] },
    { name: '数码配件', kws: ['手机壳', '支架', '贴膜', '保护套', '壳', '膜'] },
    { name: '车载用品', kws: ['车载', '车充', '支架'] },
    { name: '蓝牙耳机', kws: ['蓝牙', '耳机', '音箱', '音响'] }
  ],
  'AI文创': [
    { name: '智能终端', kws: ['WorkBuddy', 'UniClaw', '智能终端', 'AI', '机器人'] },
    { name: '配套周边', kws: ['壳', '膜', '支架', '充电', '保护套'] },
    { name: '模型手办', kws: ['模型', '手办', '玩偶'] }
  ],
  '校园文创': [
    { name: '校园纪念', kws: ['校园', '纪念', '毕业', '校友', '开学'] },
    { name: '学习文具', kws: ['笔', '笔记本', '书签', '文具', '书包', '文具盒'] },
    { name: '校园服饰', kws: ['校服', 'T恤', '卫衣', '文化衫', '班服'] },
    { name: '宿舍好物', kws: ['宿舍', '收纳', '台灯', '水杯', '抱枕'] }
  ],
  '荣誉体系': [
    { name: '奖杯', kws: ['奖杯'] },
    { name: '奖牌奖章', kws: ['奖牌', '奖章', '勋章', '纪念章'] },
    { name: '证书聘书', kws: ['证书', '聘书', '结业证'] },
    { name: '牌匾标牌', kws: ['牌匾', '标牌', '铭牌', '门牌'] },
    { name: '徽章胸章', kws: ['徽章', '胸章', '司徽'] },
    { name: '锦旗', kws: ['锦旗'] },
    { name: '纪念品', kws: ['纪念品', '纪念币', '邮票'] }
  ],
  '养生主题': [
    { name: '香囊香卡', kws: ['香囊', '香卡', '香薰', '香水', '香氛'] },
    { name: '茶饮杯具', kws: ['茶', '杯', '茶具', '茶壶', '茶杯', '保温杯'] },
    { name: '保健按摩', kws: ['按摩', '保健', '艾灸', '刮痧', '泡脚'] },
    { name: '滋补食品', kws: ['枸杞', '红枣', '蜂蜜', '参', '滋补'] },
    { name: '健身器材', kws: ['健身', '瑜伽', '跑步', '球拍'] },
    { name: '护颈护腰', kws: ['护颈', '护腰', '靠垫', '腰靠', '颈枕'] }
  ],
  '世界杯周边': [
    { name: '世界杯主题', kws: ['世界杯', 'FIFA', '足球', '球队'] },
    { name: '球衣', kws: ['球衣', '球服', '队服'] },
    { name: '徽章挂件', kws: ['徽章', '钥匙扣', '挂件', '冰箱贴'] },
    { name: '球类器材', kws: ['球', '足球', '篮球', '排球'] },
    { name: '围巾旗帜', kws: ['围巾', '旗帜', '旗子'] }
  ],
  '合作IP': [
    { name: '品牌联名', kws: ['联名', '安踏', '李宁', '合作'] },
    { name: '玩偶潮玩', kws: ['玩偶', '潮玩', '手办', '盲盒', '公仔', '摆件'] },
    { name: 'IP 周边', kws: ['IP', '周边', '衍生品'] },
    { name: '吉祥物', kws: ['吉祥物', '墩墩', '熊熊', '娃娃'] }
  ],
  '定制场景': [
    { name: '可定制好物', kws: ['定制'] },
    { name: '丝印刺绣', kws: ['丝印', '刺绣', '烫印', '激光', '雕刻'] },
    { name: '个性化', kws: ['个性化', '个性', '专属', '私人'] }
  ]
};

/* 分类清单：真实值 + 生活化显示名 + 宫格短名 */
var CATEGORY_LIST = [
  { value: '办公场景',   label: '办公桌上的小确幸', short: '办公' },
  { value: '营销场景',   label: '送人有面子的好物', short: '生活' },
  { value: '商务场景',   label: '联通人的伴手礼',   short: '商务' },
  { value: '服装体系',   label: '穿在身上的联通',   short: '服饰' },
  { value: 'eSIM文创',   label: '一方物联',         short: '数码' },
  { value: 'AI文创',     label: 'AI 生活家',        short: 'AI' },
  { value: '校园文创',   label: '校园记忆',         short: '校园' },
  { value: '荣誉体系',   label: '荣誉体系',         short: '荣誉' },
  { value: '养生主题',   label: '一刻静心',         short: '养生' },
  { value: '世界杯周边', label: '世界杯周边',       short: '世界杯' },
  { value: '合作IP',     label: '合作 IP',          short: '合作IP' },
  { value: '定制场景',   label: '可定制',           short: '定制' },
  { value: '',           label: '全部好物',         short: '全部' }
];

/* ---- ① Tab 分类导航 ---- */
function switchHomeTab(value) {
  document.querySelectorAll('.home-tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-value') === value);
  });
  if (value === 'recommend') {
    goHome();
  } else {
    goCategory(value);
  }
}

/* ---- ② 圆形分类宫格 ---- */
function findCategoryImage(catValue) {
  var p = allProducts.find(function(x) {
    return x.category === catValue && x.images && x.images.length;
  });
  if (!p && catValue === '') {
    p = allProducts.find(function(x) { return x.images && x.images.length; });
  }
  return p ? p.images[0] : null;
}

function renderRoundGrid() {
  var container = document.getElementById('roundGrid');
  if (!container) return;
  container.innerHTML = CATEGORY_LIST.map(function(c) {
    var img = findCategoryImage(c.value);
    return '<div class="round-item" onclick="goCategory(\'' + c.value + '\')">' +
      '<div class="round-icon">' +
        (img ? '<img src="' + imgUrl(img) + '" loading="lazy" alt="' + c.short + '">' : '<span class="round-fallback">📦</span>') +
      '</div>' +
      '<div class="round-label">' + c.short + '</div>' +
    '</div>';
  }).join('');
  initTouchFeedback(container.querySelectorAll('.round-item'));
}

/* ---- ③ 大 Banner 轮播（用套装大图） ---- */
var BANNERS = [
  { img: 'images/top100_910/suit_business_office_box.webp',   title: '码上礼盒 · 联通仪式感', sub: '商务办公礼盒 · 8 件套',  suit: '商务办公礼盒' },
  { img: 'images/top100_910/suit_business_travel_box.webp',   title: '说走就走的旅行',        sub: '商务旅行套装 · 7 件套',  suit: '商务旅行套装' },
  { img: 'images/top100_910/suit_new_employee_box.webp',      title: '欢迎新同事',            sub: '新员工入职套装 · 10 件套', suit: '新员工入职套装' }
];
var bannerIdx = 0;
var bannerTimer = null;

function renderBannerCarousel() {
  var track = document.getElementById('bannerCarousel');
  var dots = document.getElementById('bannerDots');
  if (!track) return;
  track.innerHTML = BANNERS.map(function(b) {
    return '<div class="banner-slide" onclick="showSuit(\'' + b.suit + '\')">' +
      '<img src="' + imgUrl(b.img) + '" alt="' + b.title + '">' +
      '<div class="banner-mask"></div>' +
      '<div class="banner-text">' +
        '<div class="banner-title">' + b.title + '</div>' +
        '<div class="banner-sub">' + b.sub + '</div>' +
        '<div class="banner-cta">查看详情 ›</div>' +
      '</div>' +
    '</div>';
  }).join('');
  if (dots) {
    dots.innerHTML = BANNERS.map(function(_, i) {
      return '<div class="banner-dot' + (i === 0 ? ' active' : '') + '" onclick="showBanner(' + i + ')"></div>';
    }).join('');
  }
  showBanner(0);
  startBannerAutoPlay();
}

function showBanner(i) {
  bannerIdx = i;
  var track = document.getElementById('bannerCarousel');
  if (track) track.style.transform = 'translateX(-' + (i * 100) + '%)';
  document.querySelectorAll('.banner-dot').forEach(function(d, j) {
    d.classList.toggle('active', j === i);
  });
}

function startBannerAutoPlay() {
  if (bannerTimer) clearInterval(bannerTimer);
  bannerTimer = setInterval(function() {
    showBanner((bannerIdx + 1) % BANNERS.length);
  }, 4000);
}

/* ---- ④ 双列主题大卡（AI 生成场景图，补足白底产品图没有场景感的短板） ---- */
function renderDuoCards() {
  var el1 = document.getElementById('duoCard1');
  var el2 = document.getElementById('duoCard2');
  if (el1) el1.style.backgroundImage = 'url(../images/generated/scene_office.webp)';
  if (el2) el2.style.backgroundImage = 'url(../images/generated/scene_gift.webp)';
}

function renderSuits() {
  var container = document.getElementById('suitsGrid');
  if (!container) return;
  var names = Object.keys(suitsData);
  if (!names.length) {
    container.innerHTML = '<p style="padding:20px;text-align:center;color:#999;">暂无套装</p>';
    return;
  }
  container.innerHTML = names.map(function(name, i) {
    var s = suitsData[name];
    var count = s.items ? s.items.length : 0;
    var cover = s.cover ? imgUrl(s.cover) : '';
    var imgHtml = cover
      ? '<div class="suit-card-img-wrap"><div class="skeleton"></div><img class="lazy-img" data-src="' + cover + '" alt="' + name + '" loading="lazy" decoding="async"></div>'
      : '<div class="suit-card-img-wrap"><div class="no-img-placeholder">图片暂无</div></div>';
    return '<div class="suit-card stagger" style="animation-delay:' + (i*80) + 'ms" onclick="showSuit(\'' + name + '\')">' +
      imgHtml +
      '<div class="suit-card-body">' +
        '<div class="suit-card-tag-row"><span class="suit-card-tag">套装</span><span class="suit-card-count">' + count + ' 件好物</span></div>' +
        '<div class="suit-card-name">' + name + '</div>' +
        '<div class="suit-card-price">¥' + s.price_settle + ' <span class="suit-card-retail">零售 ¥' + s.price_retail + '</span></div>' +
      '</div>' +
    '</div>';
  }).join('');
  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.suit-card'));
}

function showSuit(name) {
  var s = suitsData[name];
  if (!s) return;
  pageHistory.push({page: 'page-home', title: '首页'});
  showPage('page-suit');
  updateNav('suit');
  var items = s.items || [];

  var galleryHtml = '';
  if (s.gallery && s.gallery.length) {
    galleryHtml = '<div class="suit-gallery">' +
      '<div class="suit-gallery-track" id="suitGalleryTrack">' +
        s.gallery.map(function(g) { return '<img src="' + imgUrl(g) + '" alt="' + name + '">'; }).join('') +
      '</div>' +
      (s.gallery.length > 1 ? '<div class="suit-gallery-dots">' + s.gallery.map(function(_,i){ return '<span class="' + (i===0?'active':'') + '"></span>'; }).join('') + '</div>' : '') +
    '</div>';
  }

  var itemsHtml = items.map(function(it, idx) {
    var itemImg = it.img ? imgUrl(it.img) : '';
    var imgBlock = itemImg
      ? '<div class="suit-item-img-wrap"><div class="skeleton"></div><img class="lazy-img" data-src="' + itemImg + '" alt="' + it.name + '" loading="lazy" decoding="async"></div>'
      : '<div class="suit-item-img-wrap"><div class="suit-item-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="7" y="7" width="10" height="10" rx="1.5" transform="rotate(45 12 12)"/></svg></div></div>';
    var codeBlock = it.code ? '<div class="suit-item-code">74码 ' + it.code + '</div>' : '';
    return '<div class="suit-item-row stagger" style="animation-delay:' + (idx*50) + 'ms">' +
      imgBlock +
      '<div class="suit-item-info">' +
        '<div class="suit-item-name">' + it.name + '</div>' +
        codeBlock +
      '</div>' +
    '</div>';
  }).join('');

  document.getElementById('suitDetailContainer').innerHTML =
    galleryHtml +
    '<div class="suit-detail-card">' +
      '<div class="suit-detail-tag-row"><span class="suit-detail-tag">套装</span><span class="suit-detail-count">内含 ' + items.length + ' 件好物</span></div>' +
      '<div class="suit-detail-name">' + name + '</div>' +
      '<div class="suit-detail-price">' +
        '<span class="suit-detail-settle">¥' + s.price_settle + '</span>' +
        '<span class="suit-detail-retail">零售 ¥' + s.price_retail + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="suit-section-title">套装清单</div>' +
    '<div class="suit-items-list">' + itemsHtml + '</div>' +
    '<div class="suit-actions">' +
      '<div class="suit-action-btn btn-secondary" onclick="goBack()">返回</div>' +
      '<div class="suit-action-btn btn-primary" onclick="goContact()">咨询采购</div>' +
    '</div>';
  initLazyImages(document.getElementById('suitDetailContainer'));
  initSuitGallery();
  initTouchFeedback(document.querySelectorAll('.suit-action-btn'));
  window.scrollTo(0, 0);
}

function initSuitGallery() {
  var track = document.getElementById('suitGalleryTrack');
  var dots = document.querySelectorAll('.suit-gallery-dots span');
  if (!track || track.children.length <= 1) return;
  var idx = 0;
  var total = track.children.length;
  function update() {
    track.style.transform = 'translateX(-' + idx*100 + '%)';
    dots.forEach(function(d, i){ d.classList.toggle('active', i===idx); });
  }
  var startX = 0, swiping = false;
  track.parentElement.addEventListener('touchstart', function(e){ startX = e.touches[0].clientX; swiping = true; }, {passive:true});
  track.parentElement.addEventListener('touchmove', function(){}, {passive:true});
  track.parentElement.addEventListener('touchend', function(e){
    if (!swiping) return; swiping = false;
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) {
      idx = (idx + (dx < 0 ? 1 : -1) + total) % total;
      update();
    }
  }, {passive:true});
}

function goHot() {
  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-hot');
  updateNav('hot');
  // update counts
  var tcount = document.getElementById('hotTabTopCount');
  var ncount = document.getElementById('hotTabNewCount');
  if (tcount) tcount.textContent = top100Data.length || '';
  if (ncount) ncount.textContent = newData.length || '';
  switchHotTab(currentHotTab || 'top100');
}

function switchHotTab(tab) {
  currentHotTab = tab;
  document.querySelectorAll('.hot-tab').forEach(function(t){
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  var top = document.getElementById('hotTop100List');
  var nt = document.getElementById('hotNewList');
  if (tab === 'top100') {
    if (top) top.style.display = '';
    if (nt) nt.style.display = 'none';
    renderHotTop100();
  } else {
    if (top) top.style.display = 'none';
    if (nt) nt.style.display = '';
    renderHotNew();
  }
}

function renderHotTop100() {
  var container = document.getElementById('hotTop100List');
  if (!container) return;
  if (!top100Data.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-text">暂无销量数据</div></div>';
    return;
  }
  container.innerHTML = top100Data.map(function(p, i) {
    var imgs = p.images && p.images.length ? p.images : [];
    var img = imgs[0] ? '<img class="hot-img lazy-img" data-src="' + imgUrl(imgs[0]) + '" alt="' + p.name + '" loading="lazy">' : '<div class="no-img-placeholder" style="height:72px;border-radius:10px;">图片暂无</div>';
    var stock = p.inventory ? (p.inventory.total || 0) : 0;
    return '<div class="hot-row stagger" style="animation-delay:' + (i*30) + 'ms" onclick="renderProductDetail(\'' + p.product_code_74 + '\')">' +
      '<div class="hot-rank rank-' + (p.rank<=3?'top':'') + '">' + p.rank + '</div>' +
      '<div class="hot-img-wrap">' + img + '</div>' +
      '<div class="hot-info">' +
        '<div class="hot-name">' + p.name + '</div>' +
        '<div class="hot-meta">' +
          '<span class="hot-cat">' + (p.category || '') + '</span>' +
          '<span class="hot-code">' + p.product_code_74 + '</span>' +
        '</div>' +
        '<div class="hot-bottom">' +
          '<span class="hot-price">' + (p.settlement_price ? '¥'+p.settlement_price : '面议') + '</span>' +
          '<span class="hot-stock">库存 ' + stock + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.hot-row'));
}

function renderHotNew() {
  var container = document.getElementById('hotNewList');
  if (!container) return;
  if (!newData.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-text">暂无新品数据</div></div>';
    return;
  }
  // sort: items WITH product_code_74 first (in-DB before preview), then items WITHOUT code (即将上市/引入)
  var sorted = newData.slice().sort(function(a, b) {
    var aHasCode = !!a.product_code_74;
    var bHasCode = !!b.product_code_74;
    if (aHasCode !== bHasCode) return aHasCode ? -1 : 1;
    if (aHasCode && bHasCode) {
      if (a._preview !== b._preview) return a._preview ? 1 : -1;
      return a.product_code_74.localeCompare(b.product_code_74);
    }
    return a.name.localeCompare(b.name);
  });
  container.innerHTML = sorted.map(function(p, i) {
    var imgs = p.images && p.images.length ? p.images : [];
    var img = imgs[0] ? '<img class="hot-img lazy-img" data-src="' + imgUrl(imgs[0]) + '" alt="' + p.name + '" loading="lazy">' : '<div class="no-img-placeholder" style="height:72px;border-radius:10px;">图片暂无</div>';
    var isPreview = p._preview === true;
    var hasCode = !!p.product_code_74;
    // price logic: 即将上市/引入 for preview OR no-code items
    var priceHtml;
    if (isPreview || !hasCode) {
      priceHtml = '<span class="hot-price preview-price">即将上市/引入</span>';
    } else if (p.settlement_price) {
      priceHtml = '<span class="hot-price">¥' + p.settlement_price + '</span>';
    } else {
      priceHtml = '<span class="hot-price">面议</span>';
    }
    // category + code/meta
    var codeOrPreview = isPreview
      ? '<span class="hot-preview-tag">PPT 预览</span>'
      : (p.product_code_74 ? '<span class="hot-code">' + p.product_code_74 + '</span>' : '');
    var stockHtml = isPreview ? '' : '<span class="hot-stock">库存 ' + (p.inventory ? p.inventory.total || 0 : 0) + '</span>';
    return '<div class="hot-row stagger" style="animation-delay:' + (i*30) + 'ms"' + (p.product_code_74 && !isPreview ? ' onclick="renderProductDetail(\'' + p.product_code_74 + '\')"' : '') + '>' +
      '<div class="hot-rank new-rank">' + (isPreview ? '预' : '新') + '</div>' +
      '<div class="hot-img-wrap">' + img + '</div>' +
      '<div class="hot-info">' +
        '<div class="hot-name">' + p.name + '</div>' +
        '<div class="hot-meta">' +
          '<span class="hot-cat">' + (p.category || '办公场景') + '</span>' +
          codeOrPreview +
        '</div>' +
        '<div class="hot-bottom">' +
          priceHtml +
          stockHtml +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.hot-row'));
}

/* ====== 排序和图片渲染辅助函数 ====== */
function getSortPriority(p) {
  var hasStock = (p.inventory && p.inventory.total > 0);
  var hasImg = (p.images && p.images.length > 0);
  if (hasStock && hasImg) return 3;
  if (hasStock && !hasImg) return 2;
  return 1;
}
function sortByPriority(products) {
  return products.sort(function(a, b) {
    return getSortPriority(b) - getSortPriority(a);
  });
}
function normalizeImgPath(rel) {
  if (!rel) return rel;
  // strip leading "images/" since most call sites prepend it
  return rel.replace(/^images\//, '');
}
function imgUrl(rel) {
  return '../images/' + normalizeImgPath(rel);
}
function getProductImageHTML(p, isLazy) {
  if (p.images && p.images.length > 0) {
    var src = imgUrl(p.images[0]);
    if (isLazy) {
      return '<div class="skeleton"></div><img class="lazy-img" data-src="' + src + '" alt="' + p.name + '" loading="lazy" decoding="async">';
    } else {
      return '<img class="lazy-img loaded" src="' + src + '" alt="' + p.name + '" style="opacity:1" decoding="async">';
    }
  } else {
    return '<div class="no-img-placeholder">图片暂无</div>';
  }
}

/* ============================================================
   NIOLife 风格 · 商品名三层解析
   ------------------------------------------------------------
   借鉴 NIOLife「系列行 + 商品名 + 一句话」的三层商品卡片结构：
     series  —— 属于哪个"生活主题"（如"联通品牌家族""马墩墩"）
     title   —— 干净的品名（如"PU 笔记本"），去掉冗长前缀
     tagline —— 一句真实细节（如"翻开就有仪式感"）
   ============================================================ */
function parseProductName(p) {
  var raw = (p.name || '').trim();
  var series = '';

  /* ---- 1) 系列识别：按关键词归到"生活主题" ---- */
  var seriesRules = [
    [/品牌家族/, '联通品牌家族'],
    [/马墩墩/, '马墩墩'],
    [/大冬会/, '大冬会联名'],
    [/科讯熊/, '科讯熊'],
    [/魔赞/, '魔赞'],
    [/观山/, '观山系列'],
    [/校园/, '校园文创'],
    [/eSIM/i, 'eSIM 文创'],
    [/央美|中央美院/, '中央美院联名'],
    [/荣誉|奖杯|奖牌|证书|牌匾|奖章/, '荣誉体系'],
    [/世界杯|FIFA/i, '世界杯周边'],
    [/香囊|香卡|养生/, '养生主题'],
    [/通通/, '通通吉祥物'],
    [/安踏/, '安踏联名'],
    [/WorkBuddy|UniClaw/i, 'AI 生活家']
  ];
  for (var i = 0; i < seriesRules.length; i++) {
    if (seriesRules[i][0].test(raw)) { series = seriesRules[i][1]; break; }
  }

  /* ---- 2) 商品名清洗：去掉冗长前缀 ---- */
  var title = raw
    .replace(/^中国联通\s*/, '')
    .replace(/^联通文创\s*/, '')
    .replace(/^联通\s*/, '')
    .replace(/^品牌家族\s*/, '')
    .replace(/^马墩墩\s*/, '')
    .replace(/^通通\s*/, '')
    .replace(/^联通文创/, '')
    .trim();
  if (!title) title = raw;
  /* 常见缩写统一大写 */
  title = title.replace(/\bpu\b/gi, 'PU')
               .replace(/\besim\b/gi, 'eSIM')
               .replace(/\busb\b/gi, 'USB')
               .replace(/\bai\b/gi, 'AI')
               .replace(/\ba4\b/gi, 'A4')
               .replace(/\ba5\b/gi, 'A5')
               .replace(/\ba6\b/gi, 'A6');

  /* ---- 3) 系列兜底：用分类转成"生活化"说法 ---- */
  if (!series) {
    var catMap = {
      '办公场景': '办公桌上的小确幸',
      '营销场景': '送人有面子的好物',
      '商务场景': '联通人的伴手礼',
      '校园文创': '校园记忆',
      'eSIM文创': '一方物联',
      'AI文创': 'AI 生活家',
      '服装体系': '穿在身上的联通',
      '荣誉体系': '荣誉体系',
      '养生主题': '一刻静心',
      '世界杯周边': '世界杯周边',
      '合作IP': '合作 IP',
      '定制场景': '可定制'
    };
    series = catMap[p.category] || '';
  }

  /* ---- 4) 一句话卖点 ---- */
  var tagline = pickTagline(p, title);

  return { series: series, title: title, tagline: tagline };
}

/* 一句话卖点：优先从 description 抽，抽不到按关键词兜底 */
function pickTagline(p, title) {
  var desc = (p.description || '').trim();
  if (desc) {
    var m = desc.match(/[，。；;]\s*(适合[^，。；;]{2,16})/);
    if (m) return m[1];
    var m2 = desc.match(/^[^，。；;]{0,22}[，。；;]([^，。；;]{4,18})/);
    if (m2 && m2[1].length >= 4) return m2[1];
  }
  var rules = [
    [/笔记本|记事本|画册/, '翻开就有仪式感'],
    [/签字笔|中性笔|笔套装|马克笔/, '写字顺手，送礼不失礼'],
    [/冰箱贴/, '一块小小的联通记忆'],
    [/徽章|胸针/, '别在包上的小骄傲'],
    [/书签/, '读书人的体面'],
    [/便签/, '办公桌上的小确幸'],
    [/明信片|卡片|贺卡/, '写一句真心话'],
    [/香囊|香卡/, '春天的味道'],
    [/杯/, '每天都会用到'],
    [/帆布袋|帆布包|托特|背包|双肩|手袋/, '通勤路上的好搭子'],
    [/POLO|T恤|卫衣|衬衫|外套|夹克|裤/, '穿在身上的品牌感'],
    [/充电宝|数据线|充电|插线/, '出门在外的安全感'],
    [/鼠标垫/, '桌面颜值担当'],
    [/U盘|优盘/, '随身的数字伙伴'],
    [/玩偶|毛绒|手办|潮玩|盲盒/, '看一眼就想带回家'],
    [/奖杯|奖牌|奖章|证书|牌匾/, '值得被纪念的时刻'],
    [/雨伞|伞/, '晴雨都陪着'],
    [/垫|抱枕|枕/, '坐下来的松弛感'],
    [/茶|养生/, '一刻静心'],
    [/手机壳|保护壳/, '每天都在手里']
  ];
  for (var i = 0; i < rules.length; i++) {
    if (rules[i][0].test(title)) return rules[i][1];
  }
  return '联通文创精选';
}

/* ====== 新品专区 ====== */
function renderNewProducts() {
  const container = document.getElementById('newProductsList');
  if (!container) return;
  // Prefer new_products.json (TOP100 p102+ + 910 PPT p3-22); fallback to is_new=true products
  var source = [];
  if (newData && newData.length) {
    // 直接按 JSON 顺序渲染（已人工排好：有码+品牌家族在前，预览在后）
    // 只把 _preview=true 的项移到同组末尾
    var withCode = newData.filter(function(x){ return !x._preview; });
    var preview = newData.filter(function(x){ return x._preview; });
    source = withCode.concat(preview);
    // 按 product_code_74 去重（防止 new_products.json 重复条目或被污染）
    var seen = {};
    source = source.filter(function(x) {
      var k = x.product_code_74 || ('name:' + (x.name || ''));
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    // if no code at all (无 _preview 标记), fallback to is_new
    if (!source.length) source = allProducts.filter(function(p) { return p.is_new; }).slice(0, 21);
  } else {
    source = allProducts.filter(function(p) { return p.is_new; }).slice(0, 21);
  }
  if (!source.length) { container.innerHTML = '<p class="np-empty">暂无新品</p>'; return; }

  /* NIOLife 风格：瀑布流 + 三层商品卡（系列行 / 商品名 / 一句话） */
  container.innerHTML = source.map(function(p, i) {
    var isPreview = p._preview === true;
    var hasCode = !!p.product_code_74;
    var info = parseProductName(p);
    var imgs;
    try { imgs = p.images && p.images.length ? p.images : []; } catch (_) { imgs = []; }
    var imgHtml;
    try {
      imgHtml = imgs.length
        ? '<div class="skeleton"></div><img class="lazy-img" data-src="' + imgUrl(imgs[0]) + '" alt="' + (p.name||'') + '" loading="lazy" decoding="async">'
        : '<div class="no-img-placeholder">图片暂无</div>';
    } catch (_) {
      imgHtml = '<div class="no-img-placeholder">图片暂无</div>';
    }
    var priceHtml;
    if (isPreview || !hasCode) {
      priceHtml = '<div class="np-price np-price-soon">即将上市 · 欢迎咨询</div>';
    } else {
      priceHtml = '<div class="np-price">' +
        (p.settlement_price ? '<span class="np-price-now">¥' + p.settlement_price + '</span>' : '<span class="np-price-now">面议</span>') +
        (p.retail_price && p.retail_price > (p.settlement_price || 0) ? '<span class="np-price-was">¥' + p.retail_price + '</span>' : '') +
      '</div>';
    }
    var onClick = (p.product_code_74 && !isPreview)
      ? ' onclick="renderProductDetail(\'' + p.product_code_74 + '\')"'
      : '';
    return '<div class="np-card' + (isPreview || !hasCode ? ' np-card-preview' : '') + '"' + onClick + '>' +
      '<div class="np-img-wrap">' +
        imgHtml +
        (isPreview || !hasCode ? '<span class="np-badge np-badge-soon">预览</span>' : '<span class="np-badge np-badge-new">NEW</span>') +
      '</div>' +
      '<div class="np-body">' +
        (info.series ? '<div class="np-series">' + info.series + '</div>' : '') +
        '<div class="np-title">' + info.title + '</div>' +
        (info.tagline ? '<div class="np-tagline">' + info.tagline + '</div>' : '') +
        priceHtml +
        '<div class="np-code">' + (p.product_code_74 || '待定') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.np-card'));
}

/* ============================================================
   热卖推荐瀑布流（NIOLife「热销榜 TOP N」标签）
   数据源：top100_hot.json（近四周销量排序，带 rank 字段）
   ============================================================ */
function getRankBadge(rank) {
  if (!rank) return '';
  if (rank <= 3) return '<span class="np-rank np-rank-top3">热销榜 TOP ' + rank + '</span>';
  if (rank <= 10) return '<span class="np-rank">热销榜 TOP ' + rank + '</span>';
  return '';
}

function renderHotRecommend() {
  var container = document.getElementById('hotRecommendList');
  if (!container) return;
  if (!top100Data || !top100Data.length) { container.innerHTML = ''; return; }
  var list = top100Data.slice(0, 16);
  container.innerHTML = list.map(function(p) {
    var full = allProducts.find(function(x){ return x.product_code_74 === p.product_code_74; }) || p;
    var info = parseProductName(full);
    var imgs = full.images && full.images.length ? full.images : [];
    var imgHtml = imgs.length
      ? '<div class="skeleton"></div><img class="lazy-img" data-src="' + imgUrl(imgs[0]) + '" alt="' + (full.name||'') + '" loading="lazy" decoding="async">'
      : '<div class="no-img-placeholder">图片暂无</div>';
    var onClick = p.product_code_74 ? ' onclick="renderProductDetail(\'' + p.product_code_74 + '\')"' : '';
    return '<div class="np-card"' + onClick + '>' +
      '<div class="np-img-wrap">' +
        imgHtml +
        getRankBadge(p.rank) +
      '</div>' +
      '<div class="np-body">' +
        (info.series ? '<div class="np-series">' + info.series + '</div>' : '') +
        '<div class="np-title">' + info.title + '</div>' +
        (info.tagline ? '<div class="np-tagline">' + info.tagline + '</div>' : '') +
        '<div class="np-price">' +
          (p.settlement_price ? '<span class="np-price-now">¥' + p.settlement_price + '</span>' : '<span class="np-price-now">面议</span>') +
          (p.retail_price && p.retail_price > (p.settlement_price || 0) ? '<span class="np-price-was">¥' + p.retail_price + '</span>' : '') +
        '</div>' +
        '<div class="np-code">' + (p.product_code_74 || '待定') + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.np-card'));
}

/* Transform-based 新品滑动 */

/* Transform-based 新品滑动 */
let newScrollPos = 0;
function initNewScrollTransform() {
  const track = document.getElementById('newProductsList');
  if (!track) return;
  let isDown = false, startX = 0, startPos = 0;
  let velocity = 0, lastX = 0, lastTime = 0, rafId = null;
  const gap = 12, cardW = 160;

  function getMax() {
    const totalW = track.scrollWidth;
    const wrapW = track.parentElement ? track.parentElement.clientWidth : window.innerWidth;
    return Math.min(0, wrapW - totalW);
  }
  function setPos(x) {
    const max = getMax();
    newScrollPos = Math.max(max, Math.min(0, x));
    track.style.transform = 'translateX(' + newScrollPos + 'px)';
  }

  track.addEventListener('mousedown', function(e) { isDown = true; startX = e.clientX; startPos = newScrollPos; velocity = 0; lastX = e.clientX; lastTime = Date.now(); track.style.transition = 'none'; if (rafId) cancelAnimationFrame(rafId); });
  window.addEventListener('mousemove', function(e) { if (!isDown) return; var now = Date.now(), dt = now - lastTime || 16; velocity = (e.clientX - lastX) / dt * 16; lastX = e.clientX; lastTime = now; var cur = startPos + (e.clientX - startX); var max = getMax(); if (cur > 0) cur = (e.clientX - startX) * 0.4; else if (cur < max) cur = max + (e.clientX - startX - (max - startPos)) * 0.4; setPos(cur); });
  window.addEventListener('mouseup', function() {
    if (!isDown) return; isDown = false;
    var max = getMax();
    if (newScrollPos > 0 || newScrollPos < max) { track.style.transition = 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)'; setPos(newScrollPos > 0 ? 0 : max); return; }
    var pos = newScrollPos, v = velocity * 8;
    (function inertia() { v *= 0.93; pos += v; if (Math.abs(v) < 0.3) { snap(); return; } var m = getMax(); if (pos > 0) { pos = 0; v = -v * 0.3; } if (pos < m) { pos = m; v = -v * 0.3; } setPos(pos); rafId = requestAnimationFrame(inertia); })();
  });
  track.addEventListener('touchstart', function(e) { isDown = true; startX = e.touches[0].clientX; startPos = newScrollPos; velocity = 0; lastX = e.touches[0].clientX; lastTime = Date.now(); track.style.transition = 'none'; if (rafId) cancelAnimationFrame(rafId); }, {passive:true});
  track.addEventListener('touchmove', function(e) { if (!isDown) return; var now = Date.now(), dt = now - lastTime || 16; var cx = e.touches[0].clientX; velocity = (cx - lastX) / dt * 16; lastX = cx; lastTime = now; var cur = startPos + (cx - startX); var max = getMax(); if (cur > 0) cur = (cx - startX) * 0.4; else if (cur < max) cur = max + (cx - startX - (max - startPos)) * 0.4; setPos(cur); }, {passive:true});
  track.addEventListener('touchend', function() { if (!isDown) return; isDown = false; var max = getMax(); if (newScrollPos > 0 || newScrollPos < max) { track.style.transition = 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)'; setPos(newScrollPos > 0 ? 0 : max); return; } var pos = newScrollPos, v = velocity * 8; (function inertia() { v *= 0.93; pos += v; if (Math.abs(v) < 0.3) { snap(); return; } var m = getMax(); if (pos > 0) { pos = 0; v = -v * 0.3; } if (pos < m) { pos = m; v = -v * 0.3; } setPos(pos); rafId = requestAnimationFrame(inertia); })(); });
  window.addEventListener('resize', function() { setPos(newScrollPos); });

  function snap() {
    var max = getMax();
    if (newScrollPos > 0) { setPos(0); return; }
    if (newScrollPos < max) { setPos(max); return; }
    var step = cardW + gap;
    var idx = Math.round(-newScrollPos / step);
    track.style.transition = 'transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
    setPos(-idx * step);
  }
}

function scrollNewProducts(dir) {
  var track = document.getElementById('newProductsList');
  if (!track) return;
  var step = (160 + 12) * 2;
  var max = Math.min(0, track.parentElement.clientWidth - track.scrollWidth);
  var target = newScrollPos + (dir > 0 ? -step : step);
  target = Math.max(max, Math.min(0, target));
  track.style.transition = 'transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94)';
  newScrollPos = target;
  track.style.transform = 'translateX(' + target + 'px)';
}

/* ====== 产品列表筛选 ====== */
function applyFilter() {
  var cat = document.getElementById('filterCategory');
  cat = cat ? cat.value : '';
  var price = document.getElementById('filterPrice');
  price = price ? price.value : '';
  var stock = document.getElementById('filterStock');
  stock = stock ? stock.value : '';
  var sort = document.getElementById('sortBy');
  sort = sort ? sort.value : 'code';

  var filtered = allProducts.slice();
  if (cat) filtered = filtered.filter(function(p) { return p.category === cat; });
  /* 品牌矩阵筛选（选了具体分类时不叠加，避免互相冲突） */
  if (brandKeyword && !cat) {
    filtered = filtered.filter(function(p) { return (p.name || '').indexOf(brandKeyword) >= 0; });
  }
  /* 子分类筛选（NIOLife 分类页圆形宫格） */
  if (subCatKeyword && cat) {
    var subs = SUB_CATEGORY_MAP[cat] || [];
    var sub = subs.find(function(s){ return s.name === subCatKeyword; });
    if (sub) {
      filtered = filtered.filter(function(p) {
        return sub.kws.some(function(k) { return (p.name || '').indexOf(k) >= 0; });
      });
    }
  }

  if (price) {
    filtered = filtered.filter(function(p) {
      var pr = p.settlement_price;
      if (!pr && pr !== 0) return false;
      if (price === '0-50') return pr >= 0 && pr <= 50;
      if (price === '50-100') return pr > 50 && pr <= 100;
      if (price === '100-200') return pr > 100 && pr <= 200;
      if (price === '200-500') return pr > 200 && pr <= 500;
      if (price === '500+') return pr > 500;
      return true;
    });
  }

  if (stock) {
    filtered = filtered.filter(function(p) {
      var inv = p.inventory ? p.inventory.total : 0;
      if (stock === 'in') return inv > 0;
      if (stock === 'low') return inv > 0 && inv < 50;
      if (stock === 'out') return inv === 0;
      return true;
    });
  }

  if (sort === 'price-asc') filtered.sort(function(a,b) { return (a.settlement_price||0) - (b.settlement_price||0); });
  else if (sort === 'price-desc') filtered.sort(function(a,b) { return (b.settlement_price||0) - (a.settlement_price||0); });
  else if (sort === 'stock') filtered.sort(function(a,b) { return ((b.inventory&&b.inventory.total)||0) - ((a.inventory&&a.inventory.total)||0); });
  else filtered = sortByPriority(filtered);

  var countEl = document.getElementById('listCount');
  if (countEl) countEl.textContent = '共 ' + filtered.length + ' 款产品';

  /* --- 分页加载初始化 --- */
  listFilteredData = filtered;
  listVisibleCount = 0;
  var container = document.getElementById('productGrid');
  if (!container) return;
  container.innerHTML = '';

  /* 创建底部哨兵用于无限滚动 */
  var sentinel = document.createElement('div');
  sentinel.className = 'list-sentinel';
  sentinel.id = 'listSentinel';
  container.appendChild(sentinel);

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">[empty]</div><div class="empty-state-text">暂无相关产品</div></div>';
    return;
  }

  /* 初始加载第一页 */
  loadMoreProducts();

  /* 分类页分段:新品推荐 + 热卖推荐(NIOLife 分类页结构) */
  if (cat && !brandKeyword) {
    renderListSections(cat);
  } else {
    /* 非分类页时隐藏分段 */
    var ns = document.getElementById('listNewSection');
    var hs = document.getElementById('listHotSection');
    if (ns) ns.style.display = 'none';
    if (hs) hs.style.display = 'none';
  }

  /* 设置无限滚动观察器 */
  if (listObserver) listObserver.disconnect();
  listObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && listVisibleCount < listFilteredData.length) {
      loadMoreProducts();
    }
  }, { rootMargin: '200px', threshold: 0 });
  listObserver.observe(sentinel);
}

/* 分页加载更多产品 */
function loadMoreProducts() {
  var container = document.getElementById('productGrid');
  if (!container) return;
  var sentinel = document.getElementById('listSentinel');

  var start = listVisibleCount;
  var end = Math.min(start + PAGE_SIZE, listFilteredData.length);
  if (start >= end) return;

  var fragment = document.createDocumentFragment();

  for (var i = start; i < end; i++) {
    var p = listFilteredData[i];
    var card = document.createElement('div');
    card.className = 'product-card';
    card.setAttribute('onclick', "renderProductDetail('" + p.product_code_74 + "')");

    var imgWrap = document.createElement('div');
    imgWrap.className = 'product-img-wrap';
    imgWrap.innerHTML = getProductImageHTML(p, true);

    var cardBody = document.createElement('div');
    cardBody.className = 'product-card-body';
    /* NIOLife 风格三层：系列行 → 商品名 → 一句话；底部保留 74 码 + 库存 */
    var info = parseProductName(p);
    cardBody.innerHTML =
      (info.series ? '<div class="pc-series">' + info.series + '</div>' : '') +
      '<div class="pc-title">' + info.title + '</div>' +
      (info.tagline ? '<div class="pc-tagline">' + info.tagline + '</div>' : '') +
      '<div class="pc-price">' +
        '<span class="pc-price-now">' + (p.settlement_price ? '¥'+p.settlement_price : '面议') + '</span>' +
        (p.retail_price && p.retail_price > (p.settlement_price || 0) ? '<span class="pc-price-was">¥'+p.retail_price+'</span>' : '') +
      '</div>' +
      '<div class="pc-foot">' +
        '<span class="pc-code">' + (p.product_code_74 || '') + '</span>' +
        '<span class="product-card-stock ' + getStockClass(p) + '">' + getStockText(p) + '</span>' +
      '</div>';

    card.appendChild(imgWrap);
    card.appendChild(cardBody);
    fragment.appendChild(card);
  }

  listVisibleCount = end;

  /* 插入到哨兵之前 */
  if (sentinel) {
    container.insertBefore(fragment, sentinel);
  } else {
    container.appendChild(fragment);
  }

  /* 初始化新加载图片的懒加载 */
  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.product-card:not(.touch-bound)'));
  container.querySelectorAll('.product-card:not(.touch-bound)').forEach(function(el) {
    el.classList.add('touch-bound');
  });

  /* 更新加载提示 */
  updateLoadMoreHint(sentinel);
}

/* 更新底部加载提示 */
function updateLoadMoreHint(sentinel) {
  if (!sentinel) return;
  if (listVisibleCount >= listFilteredData.length) {
    sentinel.innerHTML = '<div class="list-end-hint">已加载全部 ' + listFilteredData.length + ' 款产品</div>';
  } else {
    sentinel.innerHTML = '<div class="list-loading-hint"><div class="list-spinner"></div>加载中...</div>';
  }
}

function getStockClass(p) {
  var total = p.inventory ? p.inventory.total : 0;
  if (total > 20) return 'stock-in';
  if (total > 0) return 'stock-low';
  if (p.category === '荣誉体系') return 'stock-custom';
  if (p.category === '服装体系') return 'stock-demand';
  return 'stock-out';
}
function getStockText(p) {
  var total = p.inventory ? p.inventory.total : 0;
  if (total > 20) return '现货充足';
  if (total > 0) return '库存紧张';
  if (p.category === '荣誉体系') return '定制咨询';
  if (p.category === '服装体系') return '以需定采';
  return '缺货';
}

/* ====== 搜索 ====== */
function handleSearch(value) {
  /* 实时搜索：300ms 防抖 */
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(function() {
    doSearch();
  }, 300);
}

function doSearch() {
  var q = document.getElementById('globalSearch').value.trim().toLowerCase();
  if (!q) return;

  var results = allProducts.filter(function(p) {
    return p.name.toLowerCase().includes(q) ||
      p.product_code_74.includes(q) ||
      (p.product_code_69 && p.product_code_69.includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q));
  });
  results = sortByPriority(results);

  pageHistory.push({page:'page-home', title:'首页'});
  showPage('page-list');
  updateNav('list');

  var countEl = document.getElementById('listCount');
  if (countEl) countEl.textContent = '搜索"' + q + '"：共 ' + results.length + ' 款产品';

  /* 复用分页加载机制 */
  listFilteredData = results;
  listVisibleCount = 0;
  var container = document.getElementById('productGrid');
  if (!container) return;
  container.innerHTML = '';

  var sentinel = document.createElement('div');
  sentinel.className = 'list-sentinel';
  sentinel.id = 'listSentinel';
  container.appendChild(sentinel);

  if (!results.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">[search]</div><div class="empty-state-text">未找到相关产品</div></div>';
    return;
  }

  loadMoreProducts();

  if (listObserver) listObserver.disconnect();
  listObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && listVisibleCount < listFilteredData.length) {
      loadMoreProducts();
    }
  }, { rootMargin: '200px', threshold: 0 });
  listObserver.observe(sentinel);

  window.scrollTo(0, 0);
}

/* ====== 产品详情 ====== */
function renderProductDetail(code) {
  var p = allProducts.find(function(x) { return x.product_code_74 === code; });
  if (!p) return;

  var currentPage = document.querySelector('.page.active');
  pageHistory.push({page: currentPage ? currentPage.id : 'page-home', title: currentPage ? (currentPage.querySelector('.page-back-title') ? currentPage.querySelector('.page-back-title').textContent : '首页') : '首页'});
  showPage('page-detail');
  updateNav('detail');

  var info = parseProductName(p);
  var imgs = (p.images || []).map(function(img) { return '<img src="' + imgUrl(img) + '" alt="' + p.name + '">'; }).join('');
  var imgCount = (p.images || []).length;
  var tags = [];
  if (p.is_new) tags.push('<span class="detail-tag tag-new">新品</span>');
  if (p.category) tags.push('<span class="detail-tag tag-category">' + p.category + '</span>');
  if (p.is_customizable) tags.push('<span class="detail-tag tag-custom">可定制</span>');

  var customText = '';
  if (p.category === '荣誉体系') customText = '是（联系梁明宇）';
  else if (p.category === '服装体系') customText = '是（联系宋天姿）';
  else customText = '是（联系石书宇）';
  var inv = p.inventory || {};
  var whMap = {beijing:'北京总仓', kunshan:'昆山总仓', dongguan:'东莞总仓', chengdu:'成都总仓', xiaoku:'西单仓库'};
  var invRows = Object.keys(whMap)
    .filter(function(k) { return (inv[k] || 0) > 0; })
    .sort(function(a, b) { return (inv[b] || 0) - (inv[a] || 0); })
    .map(function(k) { return '<tr><th>' + whMap[k] + '</th><td>' + inv[k] + '</td></tr>'; }).join('');

  /* 同系列好物（NIOLife 详情页相关推荐） */
  var related = allProducts.filter(function(x){
    return x.category === p.category && x.product_code_74 !== p.product_code_74 && x.images && x.images.length;
  }).slice(0, 4);
  var relatedHtml = '';
  if (related.length) {
    relatedHtml = '<div class="detail-related">' +
      '<h3>同系列好物</h3>' +
      '<div class="related-grid">' +
      related.map(function(r) {
        var ri = parseProductName(r);
        return '<div class="related-card" onclick="renderProductDetail(\'' + r.product_code_74 + '\')">' +
          '<div class="related-img"><img src="' + imgUrl(r.images[0]) + '" loading="lazy" alt="' + (r.name||'') + '"></div>' +
          '<div class="related-body">' +
            '<div class="related-title">' + ri.title + '</div>' +
            '<div class="related-price">' + (r.settlement_price ? '¥' + r.settlement_price : '面议') + '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
      '</div>' +
    '</div>';
  }

  document.getElementById('detailContainer').innerHTML =
    '<div class="detail-carousel">' +
      '<div class="detail-carousel-track">' + (imgs || '<div style="padding:40px;text-align:center;color:#999;">暂无图片</div>') + '</div>' +
      '<div class="detail-carousel-dots"></div>' +
      '<div class="detail-back" onclick="goBack()">←</div>' +
      (imgCount > 1 ? '<div class="carousel-arrow carousel-prev" onclick="window.prevSlide()">‹</div><div class="carousel-arrow carousel-next" onclick="window.nextSlide()">›</div>' : '') +
      /* NIOLife 式深色叠层：系列 + 标题 + 双价 + 编号 */
      '<div class="detail-overlay">' +
        (info.series ? '<div class="dov-series">' + info.series + '</div>' : '') +
        '<div class="dov-title">' + info.title + '</div>' +
        '<div class="dov-price">' +
          (p.settlement_price ? '<span class="dov-price-now">¥' + p.settlement_price + '</span>' : '<span class="dov-price-now">面议</span>') +
          (p.retail_price && p.retail_price > (p.settlement_price || 0) ? '<span class="dov-price-was">¥' + p.retail_price + '</span>' : '') +
        '</div>' +
        '<div class="dov-code">编号 ' + (p.product_code_74 || '-') + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="detail-body">' +
      '<div class="detail-tags">' + tags.join('') + '</div>' +
      (info.tagline ? '<div class="detail-tagline detail-tagline-body">' + info.tagline + '</div>' : '') +
      '<div class="detail-info">' +
        '<h3>编辑手记</h3>' +
        '<div class="detail-desc">' + (p.description || '这款商品来自联通文创精选，具体细节与使用场景欢迎联系对接人了解。') + '</div>' +
        '<h3>产品档案</h3>' +
        '<div class="info-row"><span class="info-label">74码</span><span class="info-value mono">' + p.product_code_74 + '</span></div>' +
        '<div class="info-row"><span class="info-label">69码</span><span class="info-value">' + (p.product_code_69 || '-') + '</span></div>' +
        '<div class="info-row"><span class="info-label">品类</span><span class="info-value">' + (p.category || '-') + '</span></div>' +
        '<div class="info-row"><span class="info-label">材质</span><span class="info-value">' + (p.material || '详见说明') + '</span></div>' +
        '<div class="info-row"><span class="info-label">规格</span><span class="info-value">' + (p.spec || '详见说明') + '</span></div>' +
        '<div class="info-row"><span class="info-label">可定制</span><span class="info-value">' + customText + '</span></div>' +
        '<div class="info-row"><span class="info-label">库存总量</span><span class="info-value">' + (inv.total || 0) + '</span></div>' +
        '<h3 style="margin-top:20px">分仓库存</h3>' +
        '<table class="inventory-table"><tbody>' + invRows + '</tbody></table>' +
      '</div>' +
      relatedHtml +
    '</div>' +
    '<div class="detail-actions">' +
      '<div class="detail-action-btn btn-secondary" onclick="goBack()">返回</div>' +
      '<div class="detail-action-btn btn-primary" onclick="goContact()">联系采购</div>' +
    '</div>';

  initDetailCarousel();
  initTouchFeedback(document.querySelectorAll('.detail-action-btn'));
  window.scrollTo(0, 0);
}

function initDetailCarousel() {
  var track = document.querySelector('.detail-carousel-track');
  var dots = document.querySelector('.detail-carousel-dots');
  if (!track || !dots || track.children.length <= 1) return;
  var slides = track.children;
  var idx = 0;
  dots.innerHTML = Array.from(slides).map(function(_,i) { return '<div class="detail-carousel-dot ' + (i===0?'active':'') + '"></div>'; }).join('');

  function update() { track.style.transform = 'translateX(-' + idx*100 + '%)'; dots.querySelectorAll('.detail-carousel-dot').forEach(function(d,i) { d.classList.toggle('active', i===idx); }); }
  window.nextSlide = function() { idx = (idx + 1) % slides.length; update(); };
  window.prevSlide = function() { idx = (idx - 1 + slides.length) % slides.length; update(); };

  var startX = 0, curX = 0, swiping = false;
  track.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; swiping = true; }, {passive:true});
  track.addEventListener('touchmove', function(e) { if (!swiping) return; curX = e.touches[0].clientX; }, {passive:true});
  track.addEventListener('touchend', function() { if (!swiping) return; swiping = false; var dx = curX - startX; if (Math.abs(dx) > 50) { dx > 0 ? window.prevSlide() : window.nextSlide(); } });
}

/* ====== 库存查询 ====== */
function switchWarehouse(wh) {
  currentWarehouse = wh;
  var whLabels = {all:'全部', beijing:'北京总仓', kunshan:'昆山总仓', dongguan:'东莞总仓', chengdu:'成都总仓', xiaoku:'西单仓库'};
  document.querySelectorAll('.warehouse-tab').forEach(function(t) {
    t.classList.toggle('active', t.textContent.trim() === whLabels[wh]);
  });
  renderInventory();
}

function renderInventory() {
  var container = document.getElementById('inventoryList');
  if (!container) return;

  var filtered = allProducts.slice();

  // 仓位筛选
  if (currentWarehouse !== 'all') {
    filtered = filtered.filter(function(p) { return p.inventory && p.inventory[currentWarehouse] > 0; });
  }

  // 价格筛选（基于结算价 settlement_price）
  if (priceFilterMin !== null || priceFilterMax !== null) {
    filtered = filtered.filter(function(p) {
      var price = p.settlement_price || 0;
      if (priceFilterMin !== null && price < priceFilterMin) return false;
      if (priceFilterMax !== null && price > priceFilterMax) return false;
      return true;
    });
  }

  // 排序：全部按总库存降序，各仓位按该仓位库存降序
  filtered.sort(function(a, b) {
    if (currentWarehouse === 'all') {
      return ((b.inventory && b.inventory.total) || 0) - ((a.inventory && a.inventory.total) || 0);
    }
    return (b.inventory[currentWarehouse] || 0) - (a.inventory[currentWarehouse] || 0);
  });

  /* --- 分页加载初始化 --- */
  invFilteredData = filtered;
  invVisibleCount = 0;
  container.innerHTML = '';

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">[empty]</div><div class="empty-state-text">暂无库存数据</div></div>';
    return;
  }

  /* 创建底部哨兵 */
  var sentinel = document.createElement('div');
  sentinel.className = 'list-sentinel';
  sentinel.id = 'invSentinel';
  container.appendChild(sentinel);

  /* 初始加载第一页 */
  loadMoreInventory();

  /* 设置无限滚动观察器 */
  if (invObserver) invObserver.disconnect();
  invObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && invVisibleCount < invFilteredData.length) {
      loadMoreInventory();
    }
  }, { rootMargin: '200px', threshold: 0 });
  invObserver.observe(sentinel);
}

/* 分页加载更多库存项 */
function loadMoreInventory() {
  var container = document.getElementById('inventoryList');
  if (!container) return;
  var sentinel = document.getElementById('invSentinel');

  var start = invVisibleCount;
  var end = Math.min(start + PAGE_SIZE, invFilteredData.length);
  if (start >= end) return;

  var fragment = document.createDocumentFragment();

  for (var i = start; i < end; i++) {
    var p = invFilteredData[i];
    var item = document.createElement('div');
    item.className = 'inv-item';
    item.setAttribute('onclick', "renderProductDetail('" + p.product_code_74 + "')");

    var imgHtml = '';
    if (p.images && p.images.length > 0) {
      imgHtml = '<img class="inv-item-img lazy-img" data-src="' + imgUrl(p.images[0]) + '" alt="' + p.name + '" loading="lazy" onerror="this.style.display=\'none\'">';
    } else {
      imgHtml = '<div class="inv-item-img no-img-placeholder" style="width:56px;height:56px;font-size:10px;border-radius:8px;">图片暂无</div>';
    }

    var stockNum = currentWarehouse === 'all'
      ? (p.inventory ? p.inventory.total : 0)
      : (p.inventory ? p.inventory[currentWarehouse] : 0);

    item.innerHTML = imgHtml +
      '<div class="inv-item-info">' +
        '<div class="inv-item-name">' + p.name + '</div>' +
        '<div class="inv-item-code">' + p.product_code_74 + '</div>' +
      '</div>' +
      '<div class="inv-item-stock">' + stockNum + '</div>';

    fragment.appendChild(item);
  }

  invVisibleCount = end;

  if (sentinel) {
    container.insertBefore(fragment, sentinel);
  } else {
    container.appendChild(fragment);
  }

  /* 初始化懒加载 */
  initLazyImages(container);
  initTouchFeedback(container.querySelectorAll('.inv-item:not(.touch-bound)'));
  container.querySelectorAll('.inv-item:not(.touch-bound)').forEach(function(el) {
    el.classList.add('touch-bound');
  });

  /* 更新加载提示 */
  if (sentinel) {
    if (invVisibleCount >= invFilteredData.length) {
      sentinel.innerHTML = '<div class="list-end-hint">已加载全部 ' + invFilteredData.length + ' 款产品</div>';
    } else {
      sentinel.innerHTML = '<div class="list-loading-hint"><div class="list-spinner"></div>加载中...</div>';
    }
  }
}

/* ====== 库存价格筛选 ====== */
function applyPriceFilter() {
  var minInput = document.getElementById('priceMin');
  var maxInput = document.getElementById('priceMax');
  priceFilterMin = minInput && minInput.value ? parseFloat(minInput.value) : null;
  priceFilterMax = maxInput && maxInput.value ? parseFloat(maxInput.value) : null;
  updatePriceTagActive();
  renderInventory();
}

function setPriceRange(min, max) {
  priceFilterMin = min;
  priceFilterMax = max;
  var minInput = document.getElementById('priceMin');
  var maxInput = document.getElementById('priceMax');
  if (minInput) minInput.value = min;
  if (maxInput) maxInput.value = max === 99999 ? '' : max;
  updatePriceTagActive();
  renderInventory();
}

function clearPriceFilter() {
  priceFilterMin = null;
  priceFilterMax = null;
  var minInput = document.getElementById('priceMin');
  var maxInput = document.getElementById('priceMax');
  if (minInput) minInput.value = '';
  if (maxInput) maxInput.value = '';
  updatePriceTagActive();
  renderInventory();
}

function updatePriceTagActive() {
  document.querySelectorAll('.price-tag').forEach(function(tag) {
    tag.classList.remove('active');
  });
  if (priceFilterMin === 0 && priceFilterMax === 50) document.querySelectorAll('.price-tag')[0].classList.add('active');
  else if (priceFilterMin === 50 && priceFilterMax === 100) document.querySelectorAll('.price-tag')[1].classList.add('active');
  else if (priceFilterMin === 100 && priceFilterMax === 200) document.querySelectorAll('.price-tag')[2].classList.add('active');
  else if (priceFilterMin === 200 && priceFilterMax === 500) document.querySelectorAll('.price-tag')[3].classList.add('active');
  else if (priceFilterMin === 500 && priceFilterMax === 99999) document.querySelectorAll('.price-tag')[4].classList.add('active');
}

/* ====== 对接人 ====== */
function renderContacts() {
  var container = document.getElementById('contactList');
  if (!container) return;
  var contacts = [
    {name:'梁明宇', role:'荣誉产品负责人', scope:'奖杯/奖牌/证书/牌匾/奖章', note:'1件起订，7-10天工期'},
    {name:'宋天姿', role:'服装产品负责人', scope:'T恤/POLO/外套/冲锋衣等', note:'1件起订，15天工期'},
    {name:'石书宇', role:'常规文创负责人', scope:'办公/生活/包袋/数码/徽章/摆件等', note:'500-1000件起订'},
  ];
  container.innerHTML = contacts.map(function(c) {
    return '<div class="contact-item">' +
      '<h4>' + c.name + ' — ' + c.role + '</h4>' +
      '<p><strong>负责范围：</strong>' + c.scope + '</p>' +
      '<p><strong>起订量/工期：</strong>' + c.note + '</p>' +
    '</div>';
  }).join('');
}

/* ====== AI 助手 ====== */
function toggleAI() {
  var chat = document.getElementById('aiChat');
  if (chat) chat.classList.toggle('active');
}

function sendAI() {
  var input = document.getElementById('aiInput');
  var body = document.getElementById('aiChatBody');
  if (!input || !body) return;
  var text = input.value.trim();
  if (!text) return;

  var userDiv = document.createElement('div');
  userDiv.className = 'ai-user-msg'; userDiv.textContent = text;
  body.appendChild(userDiv);
  input.value = '';

  var loadingDiv = document.createElement('div');
  loadingDiv.className = 'ai-bot-msg';
  loadingDiv.innerHTML = '<div class="ai-loading"><span></span><span></span><span></span></div>';
  body.appendChild(loadingDiv);
  body.scrollTop = body.scrollHeight;

  setTimeout(function() {
    loadingDiv.remove();
    var botDiv = document.createElement('div');
    botDiv.className = 'ai-bot-msg';
    botDiv.textContent = '您好！AI助手功能正在接入中，暂无法提供实时回复。如有紧急问题，请直接联系对接人。';
    body.appendChild(botDiv);
    body.scrollTop = body.scrollHeight;
  }, 1500);
}

/* ====== 返回顶部 ====== */
function scrollToTop() {
  window.scrollTo({top: 0, behavior: 'smooth'});
}

window.addEventListener('scroll', function() {
  var btn = document.querySelector('.back-to-top');
  if (btn) btn.style.opacity = window.scrollY > 300 ? '1' : '0';
  var nav = document.querySelector('.top-nav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 8);
});

/* 顶部导航滚动时增强阴影 */
function initTopNavScroll() {
  window.dispatchEvent(new Event('scroll'));
}

/* ====== 懒加载 ====== */
function initLazyImages(root) {
  if (!root || !window.IntersectionObserver) return;
  var imgs = root.querySelectorAll('img.lazy-img:not(.lazy-bound)');
  if (!imgs.length) return;
  imgs.forEach(function(img) { img.classList.add('lazy-bound'); });
  var obs = new IntersectionObserver(function(entries, observer) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var img = entry.target;
        var src = img.dataset.src;
        if (src) {
          img.src = src;
          img.onload = function() { img.classList.add('loaded'); var sk = img.parentElement ? img.parentElement.querySelector('.skeleton') : null; if (sk) sk.style.display = 'none'; };
          img.onerror = function() { img.classList.add('loaded'); var sk = img.parentElement ? img.parentElement.querySelector('.skeleton') : null; if (sk) sk.style.display = 'none'; };
        }
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '100px', threshold: 0.01 });
  imgs.forEach(function(img) { obs.observe(img); });
}

/* ====== 触摸反馈 ====== */
function initTouchFeedback(elements) {
  if (!elements) return;
  var list = elements.length !== undefined ? elements : [elements];
  list.forEach(function(el) {
    el.addEventListener('touchstart', function() { el.classList.add('pressing'); }, {passive:true});
    el.addEventListener('touchend', function() { el.classList.remove('pressing'); }, {passive:true});
    el.addEventListener('touchcancel', function() { el.classList.remove('pressing'); }, {passive:true});
    el.addEventListener('mousedown', function() { el.classList.add('pressing'); });
    el.addEventListener('mouseup', function() { el.classList.remove('pressing'); });
    el.addEventListener('mouseleave', function() { el.classList.remove('pressing'); });
  });
}

/* ============================================================
   文创事件模块
   ============================================================ */
function goEvents() {
  pageHistory.push({page: 'page-home', title: '首页'});
  showPage('page-events');
  updateNav('events');
  renderEvents();
  window.scrollTo(0, 0);
}

function renderEvents() {
  var container = document.getElementById('eventsList');
  if (!container) return;
  if (!eventsData.length) {
    container.innerHTML = '<p style="padding:20px;text-align:center;color:#999;">暂无事件</p>';
    return;
  }
  container.innerHTML = eventsData.map(function(e, i) {
    var cover = e.images && e.images.length ? e.images[0] : '';
    var coverHtml = cover
      ? '<div class="event-card-img"><img src="' + imgUrl(cover) + '" alt="' + escapeHtml(e.title) + '" loading="lazy" decoding="async"></div>'
      : '<div class="event-card-img event-card-img-placeholder">📰</div>';
    var cat = e.category || '动态';
    var date = e.date || '';
    var author = e.author || '';
    var preview = (e.body || '').slice(0, 80).replace(/\n/g, ' ');
    return '<div class="event-card stagger" style="animation-delay:' + (i*60) + 'ms" onclick="showEventDetail(\'' + e.id + '\')">' +
      coverHtml +
      '<div class="event-card-body">' +
        '<div class="event-card-meta"><span class="event-card-cat">' + escapeHtml(cat) + '</span><span class="event-card-date">' + escapeHtml(date) + '</span></div>' +
        '<div class="event-card-title">' + escapeHtml(e.title) + '</div>' +
        (e.subtitle ? '<div class="event-card-subtitle">' + escapeHtml(e.subtitle) + '</div>' : '') +
        '<div class="event-card-preview">' + escapeHtml(preview) + (preview.length>=80?'…':'') + '</div>' +
        '<div class="event-card-foot">📌 ' + escapeHtml(author) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  initTouchFeedback(container.querySelectorAll('.event-card'));
}

function showEventDetail(id) {
  var e = eventsData.find(function(x){ return x.id === id; });
  if (!e) return;
  pageHistory.push({page: 'page-events', title: '文创事件'});
  showPage('page-event-detail');
  updateNav('events');
  var imgs = e.images || [];
  var imgsHtml = imgs.map(function(src) {
    return '<div class="event-detail-img-wrap"><img src="' + imgUrl(src) + '" alt="" loading="lazy" decoding="async"></div>';
  }).join('');
  var html =
    '<div class="event-detail-meta">' +
      '<span class="event-detail-cat">' + escapeHtml(e.category||'动态') + '</span>' +
      '<span class="event-detail-date">' + escapeHtml(e.date||'') + '</span>' +
    '</div>' +
    '<h2 class="event-detail-title">' + escapeHtml(e.title) + '</h2>' +
    (e.subtitle ? '<div class="event-detail-subtitle">' + escapeHtml(e.subtitle) + '</div>' : '') +
    '<div class="event-detail-author">📌 ' + escapeHtml(e.author||'') + '</div>' +
    (imgsHtml ? '<div class="event-detail-imgs">' + imgsHtml + '</div>' : '') +
    '<div class="event-detail-body">' + escapeHtml(e.body||'').replace(/\n/g,'<br>') + '</div>' +
    '<div class="event-detail-actions"><div class="event-action-btn btn-primary" onclick="goEvents()">返回列表</div></div>';
  document.getElementById('eventDetailContainer').innerHTML = html;
  initTouchFeedback(document.querySelectorAll('.event-action-btn'));
  window.scrollTo(0, 0);
}

/* 提交事件（非管理员也可提交，提交后存 localStorage 待审） */
function openEventSubmit() {
  document.getElementById('eventFormTitle').textContent = '📮 提交事件';
  document.getElementById('eventTitleInput').value = '';
  document.getElementById('eventSubtitleInput').value = '';
  document.getElementById('eventBodyInput').value = '';
  document.getElementById('eventCategoryInput').value = '动态';
  document.getElementById('eventImgInput').value = '';
  document.getElementById('eventImgPreview').innerHTML = '';
  window._pendingEventImages = [];
  window._editingEventId = null;
  document.getElementById('eventFormModal').style.display = 'flex';
}

function closeEventForm() {
  document.getElementById('eventFormModal').style.display = 'none';
}

function onEventImagePick(ev) {
  var files = Array.from(ev.target.files || []).slice(0, 3);
  if (!files.length) return;
  window._pendingEventImages = [];
  var preview = document.getElementById('eventImgPreview');
  preview.innerHTML = '';
  var done = 0;
  files.forEach(function(f) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var dataUrl = e.target.result;
      window._pendingEventImages.push(dataUrl);
      var img = document.createElement('img');
      img.src = dataUrl;
      img.className = 'modal-preview-img';
      preview.appendChild(img);
      done++;
      if (done === files.length) {
        document.getElementById('eventImgPickText').textContent = '已选 ' + files.length + ' 张';
      }
    };
    reader.readAsDataURL(f);
  });
}

async function saveEvent() {
  var title = (document.getElementById('eventTitleInput').value || '').trim();
  var subtitle = (document.getElementById('eventSubtitleInput').value || '').trim();
  var body = (document.getElementById('eventBodyInput').value || '').trim();
  var category = document.getElementById('eventCategoryInput').value;
  if (!title || !body) {
    alert('请填写标题和正文');
    return;
  }
  var id = window._editingEventId || ('evt_' + Date.now());
  var today = new Date().toISOString().slice(0,10);
  var evt = {
    id: id,
    title: title,
    subtitle: subtitle,
    category: category,
    date: today,
    author: '联通文创',
    status: adminAuthed ? 'published' : 'pending',
    body: body,
    images: window._pendingEventImages || []
  };
  if (adminAuthed && window._editingEventId) {
    var existing = eventsData.find(function(x){return x.id===id});
    if (existing) {
      evt.author = existing.author;
      evt.date = existing.date;
    }
  }
  // 写入 eventsData
  var idx = eventsData.findIndex(function(x){return x.id===id});
  if (idx >= 0) eventsData[idx] = evt; else eventsData.unshift(evt);
  // 写入 localStorage（非管理员事件为 pending）
  if (!adminAuthed) saveLocalEvent(evt);
  closeEventForm();
  if (document.getElementById('page-events').classList.contains('active')) renderEvents();
  if (document.getElementById('page-event-detail').classList.contains('active')) showEventDetail(id);
  if (document.getElementById('page-admin').classList.contains('active')) renderAdmin();
  // 管理员模式下同步到 GitHub
  if (adminAuthed) {
    alert('正在同步到 GitHub...');
    var r = await commitToGitHub('data/events.json', eventsData, 'admin: ' + (window._editingEventId ? '更新' : '新增') + '事件 ' + title);
    if (r.ok) {
      // 同步成功后，清空本地 pending events 缓存，避免刷新后旧数据覆盖
      try { localStorage.removeItem('unicom-wenchuang-pending-events'); } catch(e) {}
      alert('✅ 事件已保存并同步到 GitHub，约 1-2 分钟后线上生效。');
    } else {
      alert('⚠️ 事件已暂存到本地，但同步 GitHub 失败：' + r.error);
    }
  } else {
    alert('已提交，等待管理员审核');
  }
}

function loadLocalEvents() {
  try {
    var raw = localStorage.getItem('unicom-wenchuang-pending-events');
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveLocalEvent(evt) {
  var arr = loadLocalEvents();
  var idx = arr.findIndex(function(x){return x.id===evt.id});
  if (idx >= 0) arr[idx] = evt; else arr.unshift(evt);
  localStorage.setItem('unicom-wenchuang-pending-events', JSON.stringify(arr));
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

/* ============================================================
   管理员模块
   ============================================================ */
function openAdminLogin() {
  document.getElementById('adminPwdInput').value = '';
  document.getElementById('adminLoginError').textContent = '';
  document.getElementById('adminLoginModal').style.display = 'flex';
  setTimeout(function(){document.getElementById('adminPwdInput').focus();}, 100);
}

function closeAdminLogin() {
  document.getElementById('adminLoginModal').style.display = 'none';
}

function adminLogin() {
  var pwd = document.getElementById('adminPwdInput').value;
  if (pwd === ADMIN_PWD) {
    adminAuthed = true;
    closeAdminLogin();
    goAdmin();
  } else {
    document.getElementById('adminLoginError').textContent = '密码错误';
  }
}

function adminLogout() {
  adminAuthed = false;
  goHome();
}

function goAdmin() {
  if (!adminAuthed) { openAdminLogin(); return; }
  pageHistory.push({page:'page-events', title:'文创事件'});
  showPage('page-admin');
  updateNav('events');
  renderAdmin();
  window.scrollTo(0,0);
}

function renderAdmin() {
  var c = document.getElementById('adminContainer');
  if (!c) return;
  c.innerHTML =
    '<div class="admin-section">' +
      '<div class="admin-section-head"><h3>📊 数据概览</h3></div>' +
      '<div class="admin-stats">' +
        statCard('产品数', allProducts.length) +
        statCard('新品数', newData.length) +
        statCard('套装数', Object.keys(suitsData).length) +
        statCard('事件数', eventsData.length, 'evt-stat') +
      '</div>' +
      '<div class="admin-export">' +
        '<button class="modal-btn modal-btn-primary" onclick="exportAdminChanges()">📥 导出所有变更（products.json + events.json）</button>' +
        '<p class="admin-tip">所有产品/事件编辑暂存浏览器本地。导出 JSON 包后，自己合并到 GitHub 仓库推送到 Cloudflare Pages 上线。</p>' +
      '</div>' +
    '</div>' +
    '<div class="admin-section">' +
      '<div class="admin-section-head"><h3>📰 文创事件管理</h3><button class="admin-add-btn" onclick="openEventSubmit()">＋ 新增事件</button></div>' +
      '<div class="admin-event-list">' +
        eventsData.map(function(e){
          var status = e.status === 'published' ? '已发布' : '待审核';
          var statusClass = e.status === 'published' ? 'admin-status-pub' : 'admin-status-pend';
          return '<div class="admin-event-row">' +
            '<div class="admin-event-info">' +
              '<div class="admin-event-title">' + escapeHtml(e.title) + '</div>' +
              '<div class="admin-event-meta">' + escapeHtml(e.date||'') + ' · ' + escapeHtml(e.category||'') + ' · ' + escapeHtml(e.author||'') + '</div>' +
            '</div>' +
            '<span class="admin-event-status ' + statusClass + '">' + status + '</span>' +
            '<button class="admin-evt-btn" onclick="editEvent(\'' + e.id + '\')">编辑</button>' +
            '<button class="admin-evt-btn admin-evt-del" onclick="deleteEvent(\'' + e.id + '\')">删除</button>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="admin-section">' +
      '<div class="admin-section-head"><h3>📦 产品管理</h3><input type="text" id="adminProductSearch" class="admin-search" placeholder="搜索 74 码或名称..." oninput="filterAdminProducts()"></div>' +
      '<div class="admin-product-list" id="adminProductList"></div>' +
    '</div>' +
    '<div class="admin-section">' +
      '<div class="admin-section-head"><h3>📢 顶部提醒管理</h3>' +
        '<button class="admin-add-btn" onclick="openNoticeForm()">＋ 新增提醒</button>' +
      '</div>' +
      '<p class="admin-tip" style="margin:0 0 10px;">提醒会显示在网站顶部红色横幅，按时间轮播。关闭浏览器后再访问会重新显示。</p>' +
      '<div class="admin-notice-list">' +
        topNotices.map(function(n, i){
          return '<div class="admin-notice-row">' +
            '<div class="admin-notice-info">' +
              '<div class="admin-notice-text">' + escapeHtml(n.text) + '</div>' +
              '<div class="admin-notice-meta">' + (n.link ? '🔗 含链接 · ' : '') + '权重 ' + (i+1) + '</div>' +
            '</div>' +
            '<button class="admin-evt-btn" onclick="editNotice(' + i + ')">编辑</button>' +
            '<button class="admin-evt-btn admin-evt-del" onclick="deleteNotice(' + i + ')">删除</button>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  renderAdminProductList('');
}

function statCard(label, val, cls) {
  return '<div class="admin-stat ' + (cls||'') + '"><div class="admin-stat-val">' + val + '</div><div class="admin-stat-label">' + label + '</div></div>';
}

function renderAdminProductList(filter) {
  var c = document.getElementById('adminProductList');
  if (!c) return;
  var kw = (filter||'').toLowerCase();
  var list = allProducts.filter(function(p){
    if (!kw) return true;
    return (p.product_code_74||'').toLowerCase().indexOf(kw) >= 0 ||
           (p.name||'').toLowerCase().indexOf(kw) >= 0;
  }).slice(0, 200);
  if (!list.length) {
    c.innerHTML = '<p style="padding:20px;text-align:center;color:#999;">没有匹配产品</p>';
    return;
  }
  c.innerHTML = list.map(function(p){
    var img = (p.images && p.images.length) ? p.images[0] : '';
    return '<div class="admin-product-row">' +
      '<div class="admin-product-img">' +
        (img ? '<img src="' + imgUrl(img) + '" alt="">' : '<div class="admin-no-img">📦</div>') +
      '</div>' +
      '<div class="admin-product-info">' +
        '<div class="admin-product-name">' + escapeHtml(p.name||'') + '</div>' +
        '<div class="admin-product-meta">' + escapeHtml(p.product_code_74||'(无码)') + ' · ¥' + (p.settlement_price||0) + '</div>' +
      '</div>' +
      '<button class="admin-evt-btn" onclick="openProductEdit(\'' + (p.product_code_74||'') + '\')">编辑</button>' +
    '</div>';
  }).join('');
}

function filterAdminProducts() {
  var kw = document.getElementById('adminProductSearch').value;
  renderAdminProductList(kw);
}

function editEvent(id) {
  var e = eventsData.find(function(x){return x.id===id});
  if (!e) return;
  window._editingEventId = id;
  document.getElementById('eventFormTitle').textContent = '✏️ 编辑事件';
  document.getElementById('eventTitleInput').value = e.title || '';
  document.getElementById('eventSubtitleInput').value = e.subtitle || '';
  document.getElementById('eventBodyInput').value = e.body || '';
  document.getElementById('eventCategoryInput').value = e.category || '动态';
  window._pendingEventImages = (e.images || []).slice();
  var preview = document.getElementById('eventImgPreview');
  preview.innerHTML = '';
  window._pendingEventImages.forEach(function(src){
    var img = document.createElement('img');
    img.src = src;
    img.className = 'modal-preview-img';
    preview.appendChild(img);
  });
  document.getElementById('eventImgPickText').textContent = window._pendingEventImages.length + ' 张图片';
  document.getElementById('eventFormModal').style.display = 'flex';
}

async function deleteEvent(id) {
  if (!confirm('确认删除这条事件？此操作会同步到 GitHub。')) return;
  eventsData = eventsData.filter(function(x){return x.id!==id});
  renderAdmin();
  alert('正在同步删除到 GitHub...');
  var r = await commitToGitHub('data/events.json', eventsData, 'admin: 删除事件 ' + id);
  if (r.ok) {
    // 同步成功后，清空本地 pending events 缓存
    try { localStorage.removeItem('unicom-wenchuang-pending-events'); } catch(e) {}
    alert('✅ 已删除并同步到 GitHub');
  } else {
    // 失败时仍然更新 localStorage，保持本地状态一致
    var arr = loadLocalEvents().filter(function(x){return x.id!==id});
    localStorage.setItem('unicom-wenchuang-pending-events', JSON.stringify(arr));
    alert('⚠️ 同步 GitHub 失败：' + r.error);
  }
}

function openProductEdit(code) {
  var p = allProducts.find(function(x){return x.product_code_74===code});
  if (!p) { alert('未找到产品'); return; }
  window._editingProduct = p;
  document.getElementById('productEditTitle').textContent = '编辑 · ' + (p.name||'');
  document.getElementById('peCode').value = p.product_code_74 || '';
  document.getElementById('peCode69').value = p.product_code_69 || '';
  document.getElementById('peName').value = p.name || '';
  document.getElementById('pePurchase').value = p.purchase_price || 0;
  document.getElementById('peSettle').value = p.settlement_price || 0;
  document.getElementById('peRetail').value = p.retail_price || 0;
  document.getElementById('peMoq').value = p.moq || 1;
  document.getElementById('peCategory').value = p.category || '';
  document.getElementById('peSubCategory').value = p.sub_category || '';
  document.getElementById('peSpec').value = p.spec || '';
  document.getElementById('peMaterial').value = p.material || '';
  document.getElementById('peLeadTime').value = p.lead_time || '';
  document.getElementById('peArrivalDate').value = p.arrival_date || '';
  document.getElementById('peStatus').value = p.status || '现货';
  document.getElementById('peIsNew').value = p.is_new ? 'true' : 'false';
  document.getElementById('peCustomizable').value = p.is_customizable ? 'true' : 'false';
  document.getElementById('peBarcode').value = p.barcode || '';
  document.getElementById('peDescription').value = p.description || '';
  document.getElementById('peImageUrl').value = (p.images && p.images[0]) || '';
  document.getElementById('peImageFile').value = '';
  document.getElementById('peImagePreview').innerHTML = p.images && p.images[0]
    ? '<img src="' + imgUrl(p.images[0]) + '" class="modal-preview-img">' : '';
  document.getElementById('productEditModal').style.display = 'flex';
}

function closeProductEdit() {
  document.getElementById('productEditModal').style.display = 'none';
}

function onProductImagePick(ev) {
  var f = ev.target.files[0];
  if (!f) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('peImagePreview').innerHTML =
      '<img src="' + e.target.result + '" class="modal-preview-img">';
    document.getElementById('peImageUrl').value = 'data:image;base64,...';
    window._pendingProductImage = e.target.result;
  };
  reader.readAsDataURL(f);
}

async function saveProductEdit() {
  var p = window._editingProduct;
  if (!p) return;
  p.product_code_74 = (document.getElementById('peCode').value || '').trim();
  p.product_code_69 = (document.getElementById('peCode69').value || '').trim();
  p.name = (document.getElementById('peName').value || '').trim();
  p.purchase_price = parseFloat(document.getElementById('pePurchase').value) || 0;
  p.settlement_price = parseFloat(document.getElementById('peSettle').value) || 0;
  p.retail_price = parseFloat(document.getElementById('peRetail').value) || 0;
  p.moq = parseInt(document.getElementById('peMoq').value) || 1;
  p.category = (document.getElementById('peCategory').value || '').trim();
  p.sub_category = (document.getElementById('peSubCategory').value || '').trim();
  p.spec = (document.getElementById('peSpec').value || '').trim();
  p.material = (document.getElementById('peMaterial').value || '').trim();
  p.lead_time = (document.getElementById('peLeadTime').value || '').trim();
  p.arrival_date = (document.getElementById('peArrivalDate').value || '').trim();
  p.status = document.getElementById('peStatus').value;
  p.is_new = document.getElementById('peIsNew').value === 'true';
  p.is_customizable = document.getElementById('peCustomizable').value === 'true';
  p.barcode = (document.getElementById('peBarcode').value || '').trim();
  p.description = (document.getElementById('peDescription').value || '').trim();
  var newImg = window._pendingProductImage || document.getElementById('peImageUrl').value.trim();
  if (newImg && !newImg.startsWith('data:')) {
    if (p.images && p.images.length) p.images[0] = newImg;
    else p.images = [newImg];
  } else if (newImg && newImg.startsWith('data:')) {
    p._pendingImage = newImg;
  }
  saveLocalProductEdit(p);

  // 同步到 GitHub：先拉取最新基准，避免覆盖其他会话的修改
  closeProductEdit();
  renderAdmin();
  alert('正在同步到 GitHub...');
  var fresh = await fetchFreshProducts();
  var base = fresh || allProducts;
  var target = base.slice();
  var key = p.product_code_74 || ('name:' + p.name);
  var tIdx = target.findIndex(function(x){
    return (x.product_code_74 || ('name:' + x.name)) === key;
  });
  if (tIdx >= 0) target[tIdx] = p; else target.unshift(p);
  var r = await commitToGitHub('data/products.json', target, 'admin: 更新产品 ' + (p.product_code_74 || p.name || ''));
  if (r.ok) {
    allProducts = target;
    // 同步成功后，清除这个产品的本地编辑缓存
    try {
      var edits = JSON.parse(localStorage.getItem('unicom-wenchuang-product-edits') || '{}');
      delete edits[key];
      localStorage.setItem('unicom-wenchuang-product-edits', JSON.stringify(edits));
    } catch(e) {}
    alert('✅ 已保存并同步到 GitHub，约 1-2 分钟后线上生效。');
  } else {
    alert('⚠️ 已保存到本地，但同步 GitHub 失败：' + r.error + '\n（修改仍暂存在浏览器，可点击「导出变更」手动处理）');
  }
}

async function deleteProduct() {
  var p = window._editingProduct;
  if (!p) return;
  if (!confirm('确认删除产品「' + (p.name||'') + '」？此操作会同步删除线上数据。')) return;
  closeProductEdit();
  renderAdmin();
  alert('正在同步删除到 GitHub...');
  var fresh = await fetchFreshProducts();
  var base = fresh || allProducts;
  var key = p.product_code_74 || ('name:' + p.name);
  var target = base.filter(function(x){
    return (x.product_code_74 || ('name:' + x.name)) !== key;
  });
  var r = await commitToGitHub('data/products.json', target, 'admin: 删除产品 ' + (p.product_code_74 || p.name || ''));
  if (r.ok) {
    allProducts = target;
    // 同步成功后，清除这个产品的本地编辑/删除缓存
    try {
      var edits = JSON.parse(localStorage.getItem('unicom-wenchuang-product-edits') || '{}');
      delete edits[key];
      localStorage.setItem('unicom-wenchuang-product-edits', JSON.stringify(edits));
      var dels = JSON.parse(localStorage.getItem('unicom-wenchuang-product-deletes') || '[]');
      dels = dels.filter(function(d){ return (d.product_code_74 || ('name:' + d.name)) !== key; });
      localStorage.setItem('unicom-wenchuang-product-deletes', JSON.stringify(dels));
    } catch(e) {}
    alert('✅ 已删除并同步到 GitHub，约 1-2 分钟后线上生效。');
  } else {
    // 失败时仍然更新本地 allProducts 和 localStorage
    var idx = allProducts.findIndex(function(x){
      return (x.product_code_74||'') === (p.product_code_74||'') && (x.name||'') === (p.name||'');
    });
    if (idx >= 0) allProducts.splice(idx, 1);
    try {
      var arr = JSON.parse(localStorage.getItem('unicom-wenchuang-product-deletes') || '[]');
      arr.push({product_code_74: p.product_code_74, name: p.name});
      localStorage.setItem('unicom-wenchuang-product-deletes', JSON.stringify(arr));
    } catch(e) {}
    alert('⚠️ 已暂存本地删除，但同步 GitHub 失败：' + r.error + '\n（请重新打开后台重试，或点击「导出变更」手动处理）');
  }
}

function saveLocalProductEdit(p) {
  try {
    var arr = JSON.parse(localStorage.getItem('unicom-wenchuang-product-edits') || '{}');
    arr[p.product_code_74 || ('name:'+p.name)] = {
      product_code_74: p.product_code_74,
      product_code_69: p.product_code_69,
      name: p.name,
      purchase_price: p.purchase_price,
      settlement_price: p.settlement_price,
      retail_price: p.retail_price,
      moq: p.moq,
      category: p.category,
      sub_category: p.sub_category,
      spec: p.spec,
      material: p.material,
      lead_time: p.lead_time,
      arrival_date: p.arrival_date,
      status: p.status,
      is_new: p.is_new,
      is_customizable: p.is_customizable,
      barcode: p.barcode,
      description: p.description,
      images: p.images,
      _pendingImage: p._pendingImage || null
    };
    localStorage.setItem('unicom-wenchuang-product-edits', JSON.stringify(arr));
  } catch(e) {}
}

function exportAdminChanges() {
  var products = JSON.parse(localStorage.getItem('unicom-wenchuang-product-edits') || '{}');
  var deletes = JSON.parse(localStorage.getItem('unicom-wenchuang-product-deletes') || '[]');
  var events = loadLocalEvents();
  var pkg = {
    exported_at: new Date().toISOString(),
    products_edit: products,
    products_delete: deletes,
    events: events
  };
  var blob = new Blob([JSON.stringify(pkg, null, 2)], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'unicom-wenchuang-changes-' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   AI 智能客服
   ============================================================ */
const AI_GREETING = '你好！我是文创智能助手 🤖\n\n我熟悉本站所有 14 大品类、' + (typeof allProducts!=='undefined'?allProducts.length:0) + '+ 个产品、套装和近期动态。\n\n试试问我：\n• "推荐一个 50 元以下的杯子"\n• "联通品牌家族有哪些"\n• "7401310560 这个产品"\n• "有哪些套装"';

let aiChatHistory = [];
let aiSettings = { provider: 'local', apiKey: '', baseUrl: '', model: '' };

function loadAISettings() {
  try {
    var s = JSON.parse(localStorage.getItem('unicom-wenchuang-ai-settings') || '{}');
    aiSettings = Object.assign(aiSettings, s);
  } catch(e) {}
}

function saveAISettingsToLocal() {
  localStorage.setItem('unicom-wenchuang-ai-settings', JSON.stringify(aiSettings));
}

function toggleAIChat() {
  var panel = document.getElementById('aiChatPanel');
  var fab = document.getElementById('aiFab');
  if (panel.style.display === 'none' || !panel.style.display) {
    panel.style.display = 'flex';
    fab.classList.add('ai-fab-hide');
    if (!aiChatHistory.length) {
      appendAIBotMessage(AI_GREETING);
    }
  } else {
    panel.style.display = 'none';
    fab.classList.remove('ai-fab-hide');
  }
}

function openAISettings() {
  loadAISettings();
  document.getElementById('aiProvider').value = aiSettings.provider || 'local';
  document.getElementById('aiApiKey').value = aiSettings.apiKey || '';
  document.getElementById('aiBaseUrl').value = aiSettings.baseUrl || '';
  document.getElementById('aiModel').value = aiSettings.model || '';
  document.getElementById('aiSettingsModal').style.display = 'flex';
}

function closeAISettings() {
  document.getElementById('aiSettingsModal').style.display = 'none';
}

function saveAISettings() {
  aiSettings.provider = document.getElementById('aiProvider').value;
  aiSettings.apiKey = document.getElementById('aiApiKey').value;
  aiSettings.baseUrl = document.getElementById('aiBaseUrl').value;
  aiSettings.model = document.getElementById('aiModel').value;
  saveAISettingsToLocal();
  closeAISettings();
  appendAIBotMessage('设置已保存 ✅ 当前模式：' + (aiSettings.provider === 'local' ? '本地规则（0 成本）' : (aiSettings.provider + ' · ' + (aiSettings.model || 'deepseek-chat'))));
}

function clearAIChat() {
  aiChatHistory = [];
  document.getElementById('aiChatBody').innerHTML = '';
  appendAIBotMessage(AI_GREETING);
}

function askQuick(text) {
  document.getElementById('aiInput').value = text;
  sendAI();
}

function sendAI() {
  var input = document.getElementById('aiInput');
  var text = (input.value || '').trim();
  if (!text) return;
  input.value = '';
  appendAIUserMessage(text);
  // typing
  var typingId = appendAITyping();
  // 异步处理
  setTimeout(function() {
    removeAITyping(typingId);
    if (aiSettings.provider === 'local') {
      var resp = localAIRespond(text);
      appendAIBotMessage(resp.text, resp.cards);
    } else {
      remoteAIRespond(text).then(function(resp){
        appendAIBotMessage(resp.text, resp.cards);
      }).catch(function(err){
        appendAIBotMessage('❌ 调用失败：' + (err.message||err) + '\n\n请检查 API key 或回到本地模式。');
      });
    }
  }, 350);
}

function appendAIUserMessage(text) {
  var body = document.getElementById('aiChatBody');
  var div = document.createElement('div');
  div.className = 'ai-msg ai-msg-user';
  div.innerHTML = '<div class="ai-msg-avatar">我</div><div class="ai-msg-bubble"></div>';
  div.querySelector('.ai-msg-bubble').innerText = text;
  body.appendChild(div);
  aiChatHistory.push({role:'user', content:text});
  scrollAIChatToBottom();
}

function appendAIBotMessage(html, cards) {
  var body = document.getElementById('aiChatBody');
  var div = document.createElement('div');
  div.className = 'ai-msg ai-msg-bot';
  var safeHtml = escapeHtml(html).replace(/\n/g, '<br>');
  var cardsHtml = '';
  if (cards && cards.length) {
    cardsHtml = '<div class="ai-card-list">' +
      cards.map(function(c){
        return '<div class="ai-card" onclick="' + (c.onclick || '') + '">' +
          '<div class="ai-card-img"><img src="' + imgUrl(c.img || '') + '" alt="" loading="lazy" onerror="this.parentNode.innerHTML=\'<div style=&quot;color:#ccc;display:flex;align-items:center;justify-content:center;height:100%&quot;>📦</div>\'"></div>' +
          '<div class="ai-card-body">' +
            '<div class="ai-card-name">' + escapeHtml(c.name) + '</div>' +
            '<div class="ai-card-price">' + (c.price ? '¥' + c.price : '') + '</div>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
  }
  div.innerHTML = '<div class="ai-msg-avatar">🤖</div><div class="ai-msg-bubble">' + safeHtml + cardsHtml + '</div>';
  body.appendChild(div);
  aiChatHistory.push({role:'assistant', content:html});
  scrollAIChatToBottom();
}

function appendAITyping() {
  var body = document.getElementById('aiChatBody');
  var div = document.createElement('div');
  div.className = 'ai-msg ai-msg-bot ai-typing-wrap';
  div.innerHTML = '<div class="ai-msg-avatar">🤖</div><div class="ai-msg-bubble"><span class="ai-typing"><span>·</span><span>·</span><span>·</span></span></div>';
  body.appendChild(div);
  scrollAIChatToBottom();
  return div;
}

function removeAITyping(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

function scrollAIChatToBottom() {
  var body = document.getElementById('aiChatBody');
  body.scrollTop = body.scrollHeight;
}

/* ====== 意图识别（本地） ====== */
function localAIRespond(query) {
  var q = (query || '').trim();
  var qLow = q.toLowerCase();
  // 问候
  if (/^(你好|您好|hi|hello|嗨|哈喽)/i.test(q)) {
    return { text: '你好！有什么可以帮你的？比如：\n• 推荐一个杯子\n• 哪些是爆款\n• 7441310560 是什么产品', cards: [] };
  }
  if (/(谢谢|感谢|thx|thanks)/i.test(q)) {
    return { text: '不客气！有任何问题随时找我 🤖', cards: [] };
  }
  // 找 74 码
  var m74 = q.match(/(74\d{10,13}|74413\d{8})/);
  if (m74) {
    var code = m74[1];
    var p = allProducts.find(function(x){return x.product_code_74===code});
    if (p) {
      return {
        text: '找到了，是这个产品：\n\n【' + p.name + '】\n74 码：' + p.product_code_74 + (p.product_code_69?'\n69 码：'+p.product_code_69:'') + '\n分类：' + (p.category||'未分类') + (p.sub_category?' / '+p.sub_category:'') + (p.spec?'\n规格：'+p.spec:'') + (p.material?'\n材质：'+p.material:'') + '\n结算价：¥' + (p.settlement_price||0) + '　零售价：¥' + (p.retail_price||0) + (p.lead_time?'\n交期：'+p.lead_time:'') + (p.description?'\n\n'+p.description:'') + '\n\n点击下方卡片查看产品详情：',
        cards: [{name:p.name, img:p.images&&p.images[0], price:p.settlement_price, onclick:'toggleAIChat();renderProductDetail("'+code+'");'}]
      };
    }
    return { text: '未找到 74 码 ' + code + ' 对应的产品。', cards: [] };
  }
  // 爆款
  if (/(爆款|热卖|热销|TOP|top)/i.test(q)) {
    var tops = top100Data.slice(0, 6);
    return { text: '本月销量 TOP 6 如下（按销量排序）：', cards: tops.map(function(p){return {name:p.name, img:p.images&&p.images[0], price:p.settlement_price||p.retail_price, onclick:'toggleAIChat();renderProductDetail("'+p.product_code_74+'");'};}) };
  }
  // 新品
  if (/(新品|新上|新出|新发布)/i.test(q)) {
    var news = newData.filter(function(x){return !x._preview;}).slice(0, 6);
    return { text: '新品专区前 6 款：', cards: news.map(function(p){return {name:p.name, img:p.images&&p.images[0], price:p.settlement_price, onclick:'toggleAIChat();renderProductDetail("'+p.product_code_74+'");'};}) };
  }
  // 套装
  if (/(套装|礼盒|商务办公|商务旅行|新员工)/i.test(q)) {
    var names = Object.keys(suitsData);
    var items = names.map(function(n){
      var s = suitsData[n];
      return {name:n, img:s.cover, price:s.price_settle, onclick:'toggleAIChat();showSuit("'+n+'");'};
    });
    return { text: '本站共有 ' + names.length + ' 款套装：', cards: items };
  }
  // 对接人
  if (/(对接|联系|采购|售后|定制流程)/i.test(q)) {
    return { text: '各省对接人 / 定制流程：\n\n• 荣誉产品（奖杯/奖牌/证书/牌匾/奖章）：梁明宇，1件起，7-10天\n• 服装产品（T恤/POLO/外套/冲锋衣等）：宋天姿，1件起，15天\n• 办公/生活/包袋/数码配件/徽章/冰箱贴/高端商务：石书宇，500-1000件起\n• 摆件/盲盒/手办/毛绒玩具：石书宇，1000件以上\n\n点击"对接人"快捷按钮查看完整列表，或返回首页 → 快捷功能 → 对接人。', cards: [] };
  }
  // 库存
  if (/(库存|在哪里|哪个仓库|有现货)/i.test(q)) {
    return { text: '库存查询支持按仓库筛选（全部 / 北京总仓 / 昆山总仓 / 东莞总仓 / 成都总仓 / 西单仓库）。\n\n返回首页 → 快捷功能 → 库存查询，或直接告诉我"查一下 7441310560 的库存"，我去数据库里查。', cards: [] };
  }
  // 价格区间
  var priceMatch = q.match(/(\d+)\s*[-到至~]\s*(\d+)\s*[元块]?/);
  if (priceMatch) {
    var lo = parseInt(priceMatch[1]);
    var hi = parseInt(priceMatch[2]);
    var list = allProducts.filter(function(p){
      var pr = p.settlement_price || 0;
      return pr >= lo && pr <= hi && p.images && p.images.length;
    }).slice(0, 6);
    if (list.length) return { text: '¥' + lo + ' - ¥' + hi + ' 区间的产品（前 6 个）：', cards: list.map(function(p){return {name:p.name, img:p.images[0], price:p.settlement_price, onclick:'toggleAIChat();renderProductDetail("'+p.product_code_74+'");'};}) };
    return { text: '这个价格区间没找到产品，试试 ¥0-50 或 ¥100-200？', cards: [] };
  }
  // 便宜 / 贵
  if (/便宜|低价|划算/i.test(q)) {
    var cheap = allProducts.filter(function(p){return p.images&&p.images.length && p.settlement_price>0;})
      .sort(function(a,b){return a.settlement_price-b.settlement_price;})
      .slice(0, 6);
    return { text: '最便宜的 6 款（按结算价升序）：', cards: cheap.map(function(p){return {name:p.name, img:p.images[0], price:p.settlement_price, onclick:'toggleAIChat();renderProductDetail("'+p.product_code_74+'");'};}) };
  }
  if (/贵的|高端|奢华/i.test(q)) {
    var rich = allProducts.filter(function(p){return p.images&&p.images.length && p.settlement_price>0;})
      .sort(function(a,b){return b.settlement_price-a.settlement_price;})
      .slice(0, 6);
    return { text: '价格最高的 6 款：', cards: rich.map(function(p){return {name:p.name, img:p.images[0], price:p.settlement_price, onclick:'toggleAIChat();renderProductDetail("'+p.product_code_74+'");'};}) };
  }
  // 推荐 + 关键词
  var keywordMap = {
    '杯子|水杯|保温杯|随行杯|冰霸杯': ['杯'],
    '笔记本|本子': ['笔记本'],
    '笔|中性笔|签字笔|钢笔': ['笔'],
    'U盘|优盘': ['U盘'],
    '充电宝|移动电源': ['充电宝'],
    '帆布袋|布袋|手提袋|背包|双肩': ['袋','包'],
    '雨伞|伞': ['伞'],
    '徽章|胸章|纪念章': ['徽章'],
    '冰箱贴|贴纸': ['冰箱贴','贴'],
    '鼠标垫': ['鼠标垫'],
    '鼠标': ['鼠标'],
    '手机壳|保护壳': ['手机壳'],
    '数据线': ['数据线'],
    'POLO|T恤|衣服': ['POLO','T恤'],
    '毛绒|玩偶': ['毛绒','玩偶'],
    '马克杯|会议杯': ['杯'],
    '礼盒|套装': ['套装','礼盒']
  };
  for (var pattern in keywordMap) {
    var re = new RegExp(pattern);
    if (re.test(q)) {
      var kws = keywordMap[pattern];
      var matched = allProducts.filter(function(p){
        if (!p.images || !p.images.length) return false;
        return kws.some(function(k){return (p.name||'').indexOf(k)>=0;});
      });
      if (matched.length) {
        var top = matched.slice(0, 6);
        return { text: '为你找到 ' + matched.length + ' 款相关产品（前 6）：', cards: top.map(function(p){return {name:p.name, img:p.images[0], price:p.settlement_price, onclick:'toggleAIChat();renderProductDetail("'+p.product_code_74+'");'};}) };
      }
    }
  }
  // 推荐 + 数字（如"50 元以下"）
  var underMatch = q.match(/(\d+)\s*元以下/);
  if (underMatch) {
    var max = parseInt(underMatch[1]);
    var list = allProducts.filter(function(p){return p.images&&p.images.length && p.settlement_price>0 && p.settlement_price<=max;}).slice(0, 6);
    if (list.length) return { text: max + ' 元以下的产品：', cards: list.map(function(p){return {name:p.name, img:p.images[0], price:p.settlement_price, onclick:'toggleAIChat();renderProductDetail("'+p.product_code_74+'");'};}) };
    return { text: max + ' 元以下暂无产品。', cards: [] };
  }
  // 品牌家族
  if (/品牌家族|联通文创/.test(q)) {
    var list = allProducts.filter(function(p){return p.images&&p.images.length && (p.name||'').indexOf('品牌家族')>=0;}).slice(0, 6);
    return { text: '品牌家族系列产品：', cards: list.map(function(p){return {name:p.name, img:p.images[0], price:p.settlement_price, onclick:'toggleAIChat();renderProductDetail("'+p.product_code_74+'");'};}) };
  }
  // 模糊匹配产品名
  var fuzzy = allProducts.filter(function(p){
    if (!p.images || !p.images.length) return false;
    return (p.name||'').indexOf(q) >= 0;
  }).slice(0, 6);
  if (fuzzy.length) return { text: '搜索 "' + q + '" 找到 ' + fuzzy.length + ' 款产品：', cards: fuzzy.map(function(p){return {name:p.name, img:p.images[0], price:p.settlement_price, onclick:'toggleAIChat();renderProductDetail("'+p.product_code_74+'");'};}) };
  // 默认
  return { text: '我没有完全理解你的问题。试试这样问：\n• "推荐一个 50 元以下的杯子"\n• "哪些是品牌家族"\n• "7441310560 是什么"\n• "本月爆款 TOP10"\n• "有哪些套装"\n• "便宜的笔记本"\n\n如果你有 DeepSeek/OpenAI 的 API key，可以在右上角 ⚙️ 启用大模型增强模式，回答会更智能。', cards: [] };
}

/* ====== LLM API（可选） ====== */
async function remoteAIRespond(query) {
  if (!aiSettings.apiKey) throw new Error('未配置 API Key');
  var baseUrl = aiSettings.baseUrl || (aiSettings.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com');
  var model = aiSettings.model || (aiSettings.provider === 'deepseek' ? 'deepseek-chat' : 'gpt-3.5-turbo');
  var systemPrompt = buildSystemPrompt();
  var messages = [{role:'system', content:systemPrompt}];
  // 加入历史（最近 6 条）
  aiChatHistory.slice(-6).forEach(function(m){ messages.push({role:m.role, content:m.content}); });
  var resp = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer ' + aiSettings.apiKey},
    body: JSON.stringify({model:model, messages:messages, temperature:0.7, max_tokens:800})
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  var data = await resp.json();
  var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return { text: text || '（无回复）', cards: [] };
}

function buildSystemPrompt() {
  var sample = allProducts.slice(0, 80).map(function(p){
    return '- ' + p.name + '（74码' + p.product_code_74 + (p.product_code_69?'/69码'+p.product_code_69:'') + '，¥' + (p.settlement_price||0) + (p.material?'/'+p.material:'') + (p.spec?'/'+p.spec:'') + '）';
  }).join('\n');
  return '你是"文创小管家"的智能助手，熟悉中国联通文创中心的所有产品（14 大品类 / 923 SKU）。\n' +
    '你的所有回答必须严格基于以下产品数据，不允许编造任何产品名/价格/编码/库存。\n' +
    '回答要简洁、口语化、推荐有针对性。结尾可建议用户点击下方产品卡片查看详情。\n\n' +
    '【产品列表（节选）】\n' + sample + '\n\n' +
    '【套装】\n' + Object.keys(suitsData).map(function(n){return '- '+n+'（¥'+suitsData[n].price_settle+'）';}).join('\n') + '\n\n' +
    '【文创事件数】' + eventsData.length + '\n';
}

/* ============================================================
   顶部轮播提醒
   ============================================================ */
let topNotices = [
  {text: '国庆主题文创备货提醒，建议各省提前两周（9月16日前）锁定库存。', link: ''},
  {text: '910 合作伙伴大会准备工作进入收尾阶段，请各组对照分工表确认。', link: ''},
  {text: '本期新增 5 款品牌家族文创（笔记本/冰箱贴/签字笔/随行杯/挂饰牌匾），可点首页新品专区查看。', link: ''}
];
let topNoticeIdx = 0;
let topNoticeTimer = null;

function loadTopNotices() {
  // 优先从服务器 notices.json 拉取（管理员提交的最新数据）
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '../data/notices.json?_=' + Date.now(), false);
    xhr.send(null);
    if (xhr.status === 200) {
      var remote = JSON.parse(xhr.responseText);
      if (Array.isArray(remote) && remote.length) {
        topNotices = remote;
        return;
      }
    }
  } catch(e) {}
  // fallback 到 localStorage
  try {
    var arr = JSON.parse(localStorage.getItem('unicom-wenchuang-top-notices') || 'null');
    if (Array.isArray(arr) && arr.length) topNotices = arr;
  } catch(e) {}
}

function saveTopNotices() {
  localStorage.setItem('unicom-wenchuang-top-notices', JSON.stringify(topNotices));
}

function renderTopNotice() {
  var el = document.getElementById('topNotice');
  var track = document.getElementById('topNoticeTrack');
  if (!el || !track) return;
  if (!topNotices.length) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  var n = topNotices[topNoticeIdx];
  var html = escapeHtml(n.text || '');
  if (n.link) html = '<a href="' + escapeHtml(n.link) + '" target="_blank" class="top-notice-link">' + html + '</a>';
  track.innerHTML = '<div class="top-notice-item">' + html + '</div>';
}

function startTopNoticeLoop() {
  stopTopNoticeLoop();
  if (topNotices.length <= 1) return;
  topNoticeTimer = setInterval(function(){
    topNoticeIdx = (topNoticeIdx + 1) % topNotices.length;
    var track = document.getElementById('topNoticeTrack');
    if (!track) return;
    track.style.opacity = '0';
    setTimeout(function(){
      renderTopNotice();
      track.style.opacity = '1';
    }, 220);
  }, 4000);
}

function stopTopNoticeLoop() {
  if (topNoticeTimer) { clearInterval(topNoticeTimer); topNoticeTimer = null; }
}

function closeTopNotice() {
  stopTopNoticeLoop();
  document.getElementById('topNotice').style.display = 'none';
  try { sessionStorage.setItem('unicom-wenchuang-notice-closed','1'); } catch(e){}
}

/* 顶部提醒 CRUD */
function openNoticeForm() {
  window._editingNoticeIdx = -1;
  document.getElementById('noticeTextInput').value = '';
  document.getElementById('noticeLinkInput').value = '';
  document.getElementById('noticeFormTitle').textContent = '📢 新增提醒';
  document.getElementById('noticeFormModal').style.display = 'flex';
}

function editNotice(idx) {
  var n = topNotices[idx];
  if (!n) return;
  window._editingNoticeIdx = idx;
  document.getElementById('noticeTextInput').value = n.text || '';
  document.getElementById('noticeLinkInput').value = n.link || '';
  document.getElementById('noticeFormTitle').textContent = '✏️ 编辑提醒';
  document.getElementById('noticeFormModal').style.display = 'flex';
}

async function deleteNotice(idx) {
  if (!confirm('确认删除这条顶部提醒？此操作会同步到 GitHub。')) return;
  topNotices.splice(idx, 1);
  saveTopNotices();
  if (topNoticeIdx >= topNotices.length) topNoticeIdx = 0;
  renderTopNotice();
  startTopNoticeLoop();
  if (typeof renderAdmin === 'function' && document.getElementById('page-admin').classList.contains('active')) renderAdmin();
  alert('正在同步到 GitHub...');
  var r = await commitToGitHub('data/notices.json', topNotices, 'admin: 删除顶部提醒 #' + idx);
  if (r.ok) {
    alert('✅ 已删除并同步到 GitHub');
  } else {
    alert('⚠️ 同步 GitHub 失败：' + r.error);
  }
}

async function saveNotice() {
  var text = (document.getElementById('noticeTextInput').value || '').trim();
  var link = (document.getElementById('noticeLinkInput').value || '').trim();
  if (!text) { alert('请填写提醒内容'); return; }
  var idx = window._editingNoticeIdx;
  var isNew = !(idx >= 0);
  var item = { text: text, link: link };
  if (idx >= 0) {
    topNotices[idx] = item;
  } else {
    topNotices.push(item);
  }
  saveTopNotices();
  closeNoticeForm();
  renderTopNotice();
  startTopNoticeLoop();
  if (typeof renderAdmin === 'function' && document.getElementById('page-admin').classList.contains('active')) renderAdmin();
  alert('正在同步到 GitHub...');
  var r = await commitToGitHub('data/notices.json', topNotices, 'admin: ' + (isNew ? '新增' : '更新') + '顶部提醒');
  if (r.ok) {
    alert('✅ 已保存并同步到 GitHub');
  } else {
    alert('⚠️ 同步 GitHub 失败：' + r.error);
  }
}

function closeNoticeForm() {
  document.getElementById('noticeFormModal').style.display = 'none';
}

/* 启动 */
document.addEventListener('DOMContentLoaded', function(){
  // 第一次启动如果用户关过，则本会话不再显示
  try {
    if (sessionStorage.getItem('unicom-wenchuang-notice-closed') === '1') return;
  } catch(e) {}
  loadTopNotices();
  renderTopNotice();
  startTopNoticeLoop();
});
