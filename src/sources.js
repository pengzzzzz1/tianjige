import { XMLParser } from "fast-xml-parser";
import { load } from "cheerio";
import crypto from "node:crypto";
import { Agent, fetch as request } from "undici";

const SOURCE_DEFINITIONS = [
  {
    id: "gov-cn-policy",
    name: "中国政府网",
    url: "https://www.gov.cn/pushinfo/v150203/pushinfo.json",
    kind: "gov_json",
    region: "国内",
    category: "政策",
    official: true,
    color: "#b4232f",
  },
  {
    id: "pbc-news",
    name: "中国人民银行",
    url: "https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html",
    kind: "html_links",
    linkPattern: "/goutongjiaoliu/113456/113469/",
    region: "国内",
    category: "政策",
    official: true,
    color: "#a6452d",
  },
  {
    id: "xinhua-finance",
    name: "新华社财经",
    url: "https://www.news.cn/fortune/news_fortune.xml",
    kind: "rss",
    region: "国内",
    category: "经济",
    official: true,
    color: "#276749",
  },
  {
    id: "cctv-latest",
    name: "央视新闻",
    url: "https://news.cctv.com/2019/07/gaiban/cmsdatainterface/page/news_1.jsonp",
    kind: "cctv_jsonp",
    region: "国内",
    category: "要闻",
    official: true,
    color: "#b3262d",
  },
  {
    id: "people-finance",
    name: "人民网财经",
    url: "http://finance.people.com.cn/",
    kind: "html_links",
    linkPattern: "/n1/",
    region: "国内",
    category: "经济",
    official: true,
    color: "#a62b31",
  },
  {
    id: "chinanews-latest",
    name: "中国新闻网",
    url: "https://www.chinanews.com.cn/rss/scroll-news.xml",
    kind: "rss",
    region: "国内",
    category: "要闻",
    authority: "一线媒体",
    color: "#365d7b",
  },
  {
    id: "chinanews-finance",
    name: "中新网财经",
    url: "https://www.chinanews.com.cn/rss/finance.xml",
    kind: "rss",
    region: "国内",
    category: "经济",
    authority: "一线媒体",
    color: "#3d6b74",
  },
  {
    id: "eastmoney-latest",
    name: "东方财富",
    url: "https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=350&order=1&needInteractData=0&page_index=1&page_size=30",
    kind: "eastmoney_json",
    region: "国内",
    category: "交易",
    authority: "一线媒体",
    color: "#c44832",
  },
  {
    id: "sina-finance",
    name: "新浪财经",
    url: "https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&k=&num=30&page=1",
    kind: "sina_json",
    region: "国内",
    category: "财经",
    authority: "一线媒体",
    color: "#b6443b",
  },
  {
    id: "wallstreetcn-live",
    name: "华尔街见闻快讯",
    url: "https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&client=pc&limit=30",
    kind: "wallstreetcn_json",
    region: "国内",
    category: "财经",
    authority: "一线媒体",
    color: "#426b88",
  },
  {
    id: "jiemian-flash",
    name: "界面新闻快讯",
    url: "https://www.jiemian.com/lists/4.html",
    kind: "html_cards",
    itemSelector: ".columns-right-center__newsflash-item",
    linkSelector: "h4 a[href]",
    titleSelector: "h4 a",
    summarySelector: ".columns-right-center__newsflash-content__summary",
    dateAttribute: "data-time",
    region: "国内",
    category: "要闻",
    authority: "一线媒体",
    color: "#4b6170",
  },
  {
    id: "yicai-latest",
    name: "第一财经",
    url: "https://www.yicai.com/news/",
    kind: "html_cards",
    itemSelector: "#newslist > a[href*='/news/']",
    titleSelector: "h2",
    summarySelector: "p",
    dateSelector: ".rightspan span",
    region: "国内",
    category: "财经",
    authority: "一线媒体",
    color: "#a24f38",
  },
  {
    id: "36kr",
    name: "36氪",
    url: "https://36kr.com/feed",
    kind: "rss",
    region: "国内",
    category: "科技",
    authority: "一线媒体",
    color: "#376a95",
  },
  {
    id: "fed-press",
    name: "美联储",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    kind: "rss",
    region: "国际",
    category: "经济",
    official: true,
    color: "#2d5f8b",
  },
  {
    id: "sec-press",
    name: "美国证券交易委员会",
    url: "https://www.sec.gov/news/pressreleases.rss",
    kind: "rss",
    region: "国际",
    category: "监管",
    official: true,
    color: "#364f6b",
  },
  {
    id: "ecb-press",
    name: "欧洲央行",
    url: "https://www.ecb.europa.eu/rss/press.html",
    kind: "rss",
    region: "国际",
    category: "经济",
    official: true,
    color: "#31598a",
  },
  {
    id: "cnbc-top",
    name: "CNBC 国际财经",
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    kind: "rss",
    region: "国际",
    category: "交易",
    official: false,
    color: "#5c3977",
  },
  {
    id: "wsj-markets",
    name: "华尔街日报市场",
    url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
    kind: "rss",
    region: "国际",
    category: "股票",
    official: false,
    color: "#4c5361",
  },
  {
    id: "marketwatch-top",
    name: "MarketWatch 市场快讯",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    kind: "rss",
    region: "国际",
    category: "交易",
    official: false,
    color: "#19684d",
  },
  {
    id: "nasdaq-markets",
    name: "Nasdaq 市场",
    url: "https://www.nasdaq.com/feed/rssoutbound?category=Markets",
    kind: "rss",
    region: "国际",
    category: "股票",
    official: false,
    color: "#15708f",
  },
  {
    id: "boe-news",
    name: "英国央行",
    url: "https://www.bankofengland.co.uk/rss/news",
    kind: "rss",
    region: "国际",
    category: "经济",
    official: true,
    color: "#875f22",
  },
  {
    id: "nbs-data",
    name: "国家统计局",
    url: "https://www.stats.gov.cn/sj/zxfb/",
    kind: "html_links",
    linkPattern: "./20",
    region: "国内",
    category: "经济",
    official: true,
    color: "#8b5a2b",
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#1f7a52",
  },
  {
    id: "mit-tech-review",
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#9d2b35",
  },
  {
    id: "ars-technica",
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#bd5d27",
  },
  {
    id: "the-verge",
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#633c92",
  },
  {
    id: "hacker-news",
    name: "Hacker News",
    url: "https://hnrss.org/frontpage",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#b05d22",
  },
  {
    id: "csrc-news",
    name: "中国证监会",
    url: "https://www.csrc.gov.cn/csrc/c100028/common_list.shtml",
    kind: "html_links",
    linkPattern: "/csrc/c100028/",
    region: "国内",
    category: "监管",
    official: true,
    color: "#9f2936",
  },
  {
    id: "sse-news",
    name: "上海证券交易所",
    url: "https://www.sse.com.cn/aboutus/mediacenter/hotandd/",
    kind: "html_links",
    linkPattern: "/aboutus/mediacenter/hotandd/c/",
    region: "国内",
    category: "交易",
    official: true,
    color: "#1e5f8a",
  },
  {
    id: "mof-news",
    name: "财政部",
    url: "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/",
    kind: "html_links",
    linkPattern: "./20",
    region: "国内",
    category: "政策",
    official: true,
    color: "#8c3d28",
  },
  {
    id: "ndrc-news",
    name: "国家发展改革委",
    url: "https://www.ndrc.gov.cn/xwdt/xwfb/",
    kind: "html_links",
    linkPattern: "./20",
    region: "国内",
    category: "经济",
    official: true,
    color: "#7c4f23",
  },
  {
    id: "mofcom-news",
    name: "商务部",
    url: "https://www.mofcom.gov.cn/xwfb/",
    kind: "html_links",
    linkPattern: "/xwfb/",
    region: "国内",
    category: "政策",
    official: true,
    color: "#8f303a",
  },
  {
    id: "ithome",
    name: "IT之家",
    url: "https://www.ithome.com/rss/",
    kind: "rss",
    region: "国内",
    category: "科技",
    official: false,
    color: "#386b82",
  },
  {
    id: "sspai",
    name: "少数派",
    url: "https://sspai.com/feed",
    kind: "rss",
    region: "国内",
    category: "数码",
    official: false,
    color: "#d5463b",
  },
  {
    id: "solidot",
    name: "Solidot",
    url: "https://www.solidot.org/index.rss",
    kind: "rss",
    region: "国内",
    category: "科技",
    official: false,
    color: "#476b3b",
  },
  {
    id: "npr-business",
    name: "NPR 商业",
    url: "https://feeds.npr.org/1006/rss.xml",
    kind: "rss",
    region: "国际",
    category: "经济",
    official: false,
    color: "#b43b31",
  },
  {
    id: "cisa-alerts",
    name: "美国网络安全局",
    url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: true,
    color: "#245a78",
  },
  {
    id: "wired",
    name: "WIRED",
    url: "https://www.wired.com/feed/rss",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#313131",
  },
  {
    id: "engadget",
    name: "Engadget",
    url: "https://www.engadget.com/rss.xml",
    kind: "rss",
    region: "国际",
    category: "数码",
    official: false,
    color: "#7654a5",
  },
  {
    id: "zdnet",
    name: "ZDNET",
    url: "https://www.zdnet.com/news/rss.xml",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#b33634",
  },
  {
    id: "eia-energy",
    name: "美国能源信息署",
    url: "https://www.eia.gov/rss/todayinenergy.xml",
    kind: "rss",
    region: "国际",
    category: "经济",
    official: true,
    color: "#347545",
  },
  {
    id: "boj-news",
    name: "日本央行",
    url: "https://www.boj.or.jp/en/rss/whatsnew.xml",
    kind: "rss",
    region: "国际",
    category: "经济",
    official: true,
    color: "#8b3e5a",
  },
  {
    id: "fed-speeches",
    name: "美联储讲话",
    url: "https://www.federalreserve.gov/feeds/speeches.xml",
    kind: "rss",
    region: "国际",
    category: "经济",
    official: true,
    color: "#315d85",
  },
  {
    id: "sec-statements",
    name: "美国证监会声明",
    url: "https://www.sec.gov/news/speeches-statements.rss",
    kind: "rss",
    region: "国际",
    category: "监管",
    official: true,
    color: "#43556f",
  },
  {
    id: "sec-litigation",
    name: "美国证监会执法",
    url: "https://www.sec.gov/enforcement-litigation/litigation-releases/rss",
    kind: "rss",
    region: "国际",
    category: "监管",
    official: true,
    color: "#614650",
  },
  {
    id: "ecb-blog",
    name: "欧洲央行观察",
    url: "https://www.ecb.europa.eu/rss/blog.html",
    kind: "rss",
    region: "国际",
    category: "经济",
    official: true,
    color: "#365e94",
  },
  {
    id: "esma-news",
    name: "欧盟证券监管局",
    url: "https://www.esma.europa.eu/rss.xml",
    kind: "rss",
    region: "国际",
    category: "监管",
    official: true,
    color: "#536b8d",
  },
  {
    id: "nvidia-blog",
    name: "NVIDIA 官方博客",
    url: "https://blogs.nvidia.com/feed/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#4f8d2f",
  },
  {
    id: "google-blog",
    name: "Google 官方博客",
    url: "https://blog.google/rss/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#3e74b7",
  },
  {
    id: "microsoft-blog",
    name: "Microsoft 官方博客",
    url: "https://blogs.microsoft.com/feed/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#477260",
  },
  {
    id: "apple-newsroom",
    name: "Apple 新闻中心",
    url: "https://www.apple.com/newsroom/rss-feed.rss",
    kind: "rss",
    region: "国际",
    category: "数码",
    official: false,
    color: "#555b65",
  },
  {
    id: "aws-news",
    name: "AWS 产品动态",
    url: "https://aws.amazon.com/about-aws/whats-new/recent/feed/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#a45f22",
  },
  {
    id: "openai-news",
    name: "OpenAI 动态",
    url: "https://openai.com/news/rss.xml",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#347469",
  },
  {
    id: "cftc-press",
    name: "美国商品期货交易委员会",
    url: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml",
    kind: "rss",
    region: "国际",
    category: "监管",
    official: true,
    color: "#355b78",
  },
  {
    id: "finra-news",
    name: "美国金融业监管局",
    url: "https://www.finra.org/media-center/newsreleases/rss",
    kind: "rss",
    region: "国际",
    category: "监管",
    official: true,
    color: "#3f647c",
  },
  {
    id: "cnbc-investing",
    name: "CNBC 投资",
    url: "https://www.cnbc.com/id/15839069/device/rss/rss.html",
    kind: "rss",
    region: "国际",
    category: "投资",
    official: false,
    color: "#385f79",
  },
  {
    id: "kiplinger-investing",
    name: "Kiplinger 投资",
    url: "https://www.kiplinger.com/feed/all",
    kind: "rss",
    region: "国际",
    category: "投资",
    official: false,
    color: "#80512e",
  },
  {
    id: "nist-news",
    name: "美国国家标准与技术研究院",
    url: "https://www.nist.gov/news-events/news/rss.xml",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: true,
    color: "#2f6470",
  },
  {
    id: "nasa-technology",
    name: "NASA 科技",
    url: "https://www.nasa.gov/technology/feed/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: true,
    color: "#355a82",
  },
  {
    id: "w3c-news",
    name: "W3C 标准动态",
    url: "https://www.w3.org/news/feed/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: true,
    color: "#365d72",
  },
  {
    id: "ieee-spectrum",
    name: "IEEE Spectrum",
    url: "https://spectrum.ieee.org/feeds/feed.rss",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    color: "#5e526e",
  },
  {
    id: "samsung-newsroom",
    name: "Samsung 新闻中心",
    url: "https://news.samsung.com/global/feed",
    kind: "rss",
    region: "国际",
    category: "数码",
    official: false,
    authority: "官方发布",
    color: "#315f8d",
  },
  {
    id: "intel-newsroom",
    name: "Intel 新闻中心",
    url: "https://newsroom.intel.com/feed",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    authority: "官方发布",
    color: "#286778",
  },
  {
    id: "meta-newsroom",
    name: "Meta 新闻中心",
    url: "https://about.fb.com/news/feed/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    authority: "官方发布",
    color: "#3e6291",
  },
  {
    id: "github-blog",
    name: "GitHub 官方博客",
    url: "https://github.blog/feed/",
    kind: "rss",
    region: "国际",
    category: "科技",
    official: false,
    authority: "官方发布",
    color: "#4c5860",
  },
  {
    id: "lenovo-newsroom",
    name: "Lenovo 新闻中心",
    url: "https://news.lenovo.com/feed/",
    kind: "rss",
    region: "国际",
    category: "数码",
    official: false,
    authority: "官方发布",
    color: "#8a3f3c",
  },
  {
    id: "macrumors",
    name: "MacRumors",
    url: "https://feeds.macrumors.com/MacRumors-All",
    kind: "rss",
    region: "国际",
    category: "数码",
    official: false,
    color: "#536875",
  },
  {
    id: "android-authority",
    name: "Android Authority",
    url: "https://www.androidauthority.com/feed/",
    kind: "rss",
    region: "国际",
    category: "数码",
    official: false,
    color: "#4c7354",
  },
  {
    id: "toms-hardware",
    name: "Tom's Hardware",
    url: "https://www.tomshardware.com/feeds.xml",
    kind: "rss",
    region: "国际",
    category: "数码",
    official: false,
    color: "#7c493f",
  },
  {
    id: "cnet-news",
    name: "CNET",
    url: "https://www.cnet.com/rss/news/",
    kind: "rss",
    region: "国际",
    category: "数码",
    official: false,
    color: "#9a3a3f",
  },
  {
    id: "gsmarena",
    name: "GSMArena",
    url: "https://www.gsmarena.com/rss-news-reviews.php3",
    kind: "rss",
    region: "国际",
    category: "数码",
    official: false,
    color: "#536b72",
  },
  {
    id: "xinhua-sports",
    name: "新华社体育",
    url: "https://sports.news.cn/",
    kind: "html_links",
    linkPattern: "/sports/",
    region: "国内",
    category: "体育",
    official: true,
    color: "#8b3f42",
  },
  {
    id: "chinanews-sports",
    name: "中国新闻网体育",
    url: "https://www.chinanews.com.cn/rss/sports.xml",
    kind: "rss",
    region: "国内",
    category: "体育",
    official: false,
    authority: "一线媒体",
    color: "#6d5147",
  },
  {
    id: "espn-top",
    name: "ESPN 体育",
    url: "https://www.espn.com/espn/rss/news",
    kind: "rss",
    region: "国际",
    category: "体育",
    official: false,
    authority: "一线媒体",
    color: "#a13d3d",
  },
  {
    id: "sky-sports",
    name: "Sky Sports",
    url: "https://www.skysports.com/rss/12040",
    kind: "rss",
    region: "国际",
    category: "体育",
    official: false,
    authority: "一线媒体",
    color: "#3d5f85",
  },
  {
    id: "formula1-news",
    name: "F1 官方资讯",
    url: "https://www.formula1.com/en/latest/all.xml",
    kind: "rss",
    region: "国际",
    category: "体育",
    official: false,
    authority: "官方发布",
    color: "#a23838",
  },
];

const CORPORATE_OFFICIAL_IDS = new Set([
  "nvidia-blog", "google-blog", "microsoft-blog", "apple-newsroom", "aws-news", "openai-news",
]);

const FIRST_LINE_MEDIA_IDS = new Set([
  "xinhua-finance", "cnbc-top", "wsj-markets", "marketwatch-top", "nasdaq-markets",
  "npr-business", "techcrunch", "mit-tech-review", "ars-technica", "the-verge", "wired", "zdnet",
]);

export const DEFAULT_SOURCES = SOURCE_DEFINITIONS.map((source) => ({
  ...source,
  authority: source.authority
    || (source.official || CORPORATE_OFFICIAL_IDS.has(source.id) ? "官方发布" : null)
    || (FIRST_LINE_MEDIA_IDS.has(source.id) ? "一线媒体" : "专业媒体"),
}));

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
});

const SOURCE_CONFIG_BY_ID = new Map(SOURCE_DEFINITIONS.map((source) => [source.id, source]));
const sourceDispatcher = new Agent({ connections: 4, pipelining: 1, keepAliveTimeout: 10_000 });

export async function fetchSource(source) {
  const configured = SOURCE_CONFIG_BY_ID.get(source.id);
  const activeSource = configured ? { ...configured, ...source } : source;
  const requestUrl = buildRequestUrl(activeSource);
  const response = await request(requestUrl, {
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/xml, application/json, text/html, */*",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Tianjige/1.5",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(18_000),
    dispatcher: sourceDispatcher,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const body = await response.text();
  let items;
  if (activeSource.kind === "gov_json") items = parseGovJson(body, activeSource);
  else if (activeSource.kind === "cctv_jsonp") items = parseCctvJsonp(body, activeSource);
  else if (activeSource.kind === "eastmoney_json") items = parseEastmoneyJson(body, activeSource);
  else if (activeSource.kind === "sina_json") items = parseSinaJson(body, activeSource);
  else if (activeSource.kind === "wallstreetcn_json") items = parseWallstreetcnJson(body, activeSource);
  else if (activeSource.kind === "html_cards") items = parseHtmlCards(body, activeSource);
  else if (activeSource.kind === "html_links") items = parseHtmlLinks(body, activeSource);
  else items = parseRss(body, activeSource);
  if (!items.length) throw new Error("来源未返回可用条目");
  return items;
}

function buildRequestUrl(source) {
  const url = new URL(source.url);
  if (source.kind === "eastmoney_json") url.searchParams.set("req_trace", `tianjige-${Date.now()}`);
  if (source.kind === "sina_json") url.searchParams.set("r", String(Math.random()));
  return url.href;
}

export function parseRss(xml, source) {
  const document = xmlParser.parse(xml);
  const rawItems = toArray(document?.rss?.channel?.item ?? document?.feed?.entry ?? []);
  return rawItems.slice(0, 30).map((entry) => {
    const link = readLink(entry.link);
    const title = cleanText(readText(entry.title));
    const summary = cleanText(
      readText(entry.encoded) || readText(entry.description) || readText(entry.summary) || readText(entry.content),
    ).slice(0, 900);
    const publishedAt = normalizeDate(
      readText(entry.pubDate) || readText(entry.published) || readText(entry.updated) || readText(entry.date),
      link,
    );
    const guid = readText(entry.guid) || entry?.id || link || `${title}-${publishedAt}`;
    return normalizeItem({ guid: String(readText(guid)), link, title, summary, publishedAt }, source);
  }).filter((item) => item.title && item.url);
}

export function parseGovJson(json, source) {
  const rows = JSON.parse(json);
  return toArray(rows).slice(0, 50).map((entry) => normalizeItem({
    guid: entry.link || entry.title,
    link: entry.link,
    title: entry.title,
    summary: entry.description || "",
    publishedAt: normalizeDate(entry.pubDate || entry.date),
  }, source)).filter((item) => item.title && item.url);
}

export function parseCctvJsonp(text, source) {
  const json = text.trim().replace(/^news\s*\(/, "").replace(/\)\s*;?$/, "");
  const rows = JSON.parse(json)?.data?.list || [];
  return toArray(rows).slice(0, 40).map((entry) => normalizeItem({
    guid: entry.id || entry.url,
    link: entry.url,
    title: entry.title,
    summary: entry.brief || "",
    publishedAt: normalizePublishedDate(entry.focus_date),
  }, source)).filter((item) => item.title && item.url);
}

export function parseEastmoneyJson(json, source) {
  const rows = JSON.parse(json)?.data?.list || [];
  return toArray(rows).slice(0, 40).map((entry) => normalizeItem({
    guid: entry.code || entry.uniqueUrl || entry.url,
    link: entry.uniqueUrl || entry.url,
    title: entry.title,
    summary: entry.summary || entry.mediaName || "",
    publishedAt: normalizePublishedDate(entry.showTime),
  }, source)).filter((item) => item.title && item.url);
}

export function parseSinaJson(json, source) {
  const rows = JSON.parse(json)?.result?.data || [];
  return toArray(rows).slice(0, 40).map((entry) => normalizeItem({
    guid: entry.docid || entry.oid || entry.url,
    link: entry.url || entry.wapurl,
    title: entry.title,
    summary: entry.intro || entry.summary || "",
    publishedAt: normalizePublishedDate(entry.ctime || entry.mtime),
  }, source)).filter((item) => item.title && item.url);
}

export function parseWallstreetcnJson(json, source) {
  const rows = JSON.parse(json)?.data?.items || [];
  return toArray(rows).slice(0, 40).map((entry) => normalizeItem({
    guid: entry.id || entry.uri,
    link: entry.uri,
    title: entry.title || cleanText(entry.content_text).slice(0, 90),
    summary: entry.content_text || entry.content || "",
    publishedAt: normalizePublishedDate(entry.display_time),
  }, source)).filter((item) => item.title && item.url);
}

export function parseHtmlLinks(html, source) {
  const $ = load(html);
  const seen = new Set();
  const items = [];
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") || "";
    const rawTitle = cleanText($(element).text());
    const contextText = cleanText($(element).closest("li, tr, article, .item, .list-item").first().text());
    const title = stripEmbeddedDate(rawTitle);
    if (!href.includes(source.linkPattern || "__never__") || title.length < 8) return;
    const link = new URL(href, source.url).href;
    if (seen.has(link)) return;
    seen.add(link);
    const publishedAt = normalizePublishedDate(findDateText(rawTitle) || findDateText(contextText), link);
    items.push(normalizeItem({ guid: link, link, title, summary: "", publishedAt }, source));
  });
  return items.slice(0, 30);
}

export function parseHtmlCards(html, source) {
  const $ = load(html);
  const seen = new Set();
  const items = [];
  $(source.itemSelector).each((_, element) => {
    const item = $(element);
    const linkElement = source.linkSelector ? item.find(source.linkSelector).first() : item;
    const href = linkElement.attr("href") || item.attr("href") || "";
    if (!href) return;
    const link = new URL(href, source.url).href;
    if (seen.has(link)) return;
    seen.add(link);
    const title = cleanText(source.titleSelector ? item.find(source.titleSelector).first().text() : linkElement.text());
    const summary = cleanText(source.summarySelector ? item.find(source.summarySelector).first().text() : "");
    const dateText = source.dateAttribute
      ? item.attr(source.dateAttribute)
      : (source.dateSelector ? item.find(source.dateSelector).first().text() : "");
    items.push(normalizeItem({
      guid: item.attr("data-id") || link,
      link,
      title,
      summary,
      publishedAt: normalizePublishedDate(dateText, link),
    }, source));
  });
  return items.filter((item) => item.title && item.url).slice(0, 40);
}

function normalizeItem(item, source) {
  const language = isMostlyChinese(item.title + item.summary) ? "zh" : "other";
  const parsedDate = new Date(item.publishedAt);
  const publishedAt = !Number.isNaN(parsedDate.getTime()) && parsedDate.getTime() <= Date.now() + 10 * 60_000
    ? parsedDate.toISOString()
    : new Date().toISOString();
  return {
    sourceId: source.id,
    guid: item.guid || crypto.createHash("sha1").update(item.link + item.title).digest("hex"),
    url: item.link,
    title: cleanText(item.title).slice(0, 500),
    titleZh: language === "zh" ? cleanText(item.title).slice(0, 500) : null,
    summary: cleanText(item.summary).slice(0, 900),
    summaryZh: language === "zh" ? cleanText(item.summary).slice(0, 900) : null,
    publishedAt,
    region: source.region,
    category: source.category,
    language,
    translated: language === "zh",
    tags: inferTags(`${item.title} ${item.summary}`),
  };
}

function readLink(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const preferred = value.find((link) => !link?.["@_rel"] || link?.["@_rel"] === "alternate") || value[0];
    return readLink(preferred);
  }
  if (value && typeof value === "object") return value["@_href"] || value["#text"] || "";
  return "";
}

function readText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(readText).join(" ");
  if (typeof value === "object") {
    if (value["#text"] != null) return readText(value["#text"]);
    if (value["@_href"]) return value["@_href"];
    return Object.entries(value)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, nested]) => readText(nested))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function cleanText(value) {
  if (!value) return "";
  const $ = load(`<body>${String(value)}</body>`);
  return $("body").text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDate(value, fallbackUrl = "") {
  let candidate = value;
  if (!candidate && fallbackUrl) {
    const urlDate = fallbackUrl.match(/\/(20\d{2})[-/](\d{2})[-/](\d{2})(?:\/|_|$)/)
      || fallbackUrl.match(/\/(20\d{2})\/(\d{2})(\d{2})(?:\/|_|$)/)
      || fallbackUrl.match(/(20\d{2})(\d{2})(\d{2})/);
    if (urlDate) candidate = `${urlDate[1]}-${urlDate[2]}-${urlDate[3]}T12:00:00Z`;
  }
  const date = candidate ? new Date(candidate) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizePublishedDate(value, fallbackUrl = "") {
  const text = String(value || "").trim();
  if (/^\d{10}$/.test(text)) return new Date(Number(text) * 1000).toISOString();
  if (/^\d{13}$/.test(text)) return new Date(Number(text)).toISOString();
  const minutes = text.match(/^(\d+)\s*分钟前/);
  if (minutes) return new Date(Date.now() - Number(minutes[1]) * 60_000).toISOString();
  const hours = text.match(/^(\d+)\s*小时前/);
  if (hours) return new Date(Date.now() - Number(hours[1]) * 3_600_000).toISOString();
  const yesterday = text.match(/^昨天\s*(\d{1,2}):(\d{2})/);
  if (yesterday) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    date.setHours(Number(yesterday[1]), Number(yesterday[2]), 0, 0);
    return date.toISOString();
  }
  const monthDay = text.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (monthDay) {
    const date = new Date();
    date.setMonth(Number(monthDay[1]) - 1, Number(monthDay[2]));
    date.setHours(Number(monthDay[3]), Number(monthDay[4]), 0, 0);
    return date.toISOString();
  }
  const absolute = text.match(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (absolute) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = absolute;
    const timestamp = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}+08:00`;
    return normalizeDate(timestamp, fallbackUrl);
  }
  const compact = text.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) {
    return normalizeDate(`${compact[1]}-${compact[2]}-${compact[3]}T00:00:00+08:00`, fallbackUrl);
  }
  return normalizeDate(text, fallbackUrl);
}

function findDateText(text) {
  return String(text || "").match(/20\d{2}[-年/]\d{1,2}[-月/]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|20\d{6}/)?.[0] || "";
}

function stripEmbeddedDate(text) {
  return cleanText(String(text || "")
    .replace(/\s*20\d{2}[-年/]\d{1,2}[-月/]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/, "")
    .replace(/\s*20\d{6}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/, ""));
}

function inferTags(text) {
  const rules = [
    ["利率", /利率|降息|加息|interest rate|rate cut|rate hike/i],
    ["通胀", /通胀|物价|inflation|CPI|PPI/i],
    ["人工智能", /人工智能|AI\b|artificial intelligence/i],
    ["能源", /能源|石油|原油|天然气|energy|oil|gas/i],
    ["银行", /银行|bank|banking/i],
    ["监管", /监管|执法|处罚|regulation|enforcement|penalt/i],
    ["财报", /财报|业绩|营收|earnings|revenue|profit/i],
    ["债券", /债券|国债|bond|treasury|yield/i],
    ["汇率", /汇率|人民币|美元|外汇|currency|forex|dollar/i],
    ["股票", /股票|股市|A股|港股|美股|equity|stock|shares?|S&P|Nasdaq/i],
    ["交易", /交易|成交|期货|期权|trading|futures?|options?/i],
    ["芯片", /芯片|半导体|GPU|semiconductor|chipmaker/i],
    ["网络安全", /网络安全|黑客|漏洞|cybersecurity|cyberattack|ransomware/i],
    ["云计算", /云计算|数据中心|cloud computing|data cent(er|re)/i],
    ["消费电子", /手机|智能手机|平板|笔记本|可穿戴|smartphone|handset|tablet|laptop|wearable/i],
    ["投资", /投资|资产配置|基金|ETF|portfolio|asset allocation|invest(or|ing|ment)/i],
    ["新能源车", /新能源车|电动车|electric vehicle|\bEV\b/i],
    ["加密资产", /比特币|以太坊|加密货币|bitcoin|ethereum|crypto/i],
    ["供应链", /供应链|供应商|supply chain|supplier/i],
    ["足球", /足球|世界杯|欧冠|英超|football|soccer|FIFA|UEFA/i],
    ["篮球", /篮球|NBA|CBA|basketball/i],
    ["赛车", /赛车|一级方程式|Formula 1|\bF1\b|motorsport/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag).slice(0, 4);
}

function isMostlyChinese(text) {
  const characters = String(text || "").replace(/\s/g, "");
  if (!characters) return false;
  const chinese = (characters.match(/[\u3400-\u9fff]/g) || []).length;
  return chinese / characters.length > 0.25;
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
