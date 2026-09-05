// 中文专名词典与停用词表
// 中文没有分词器，专名只能靠词典命中。词典是给中文用的，
// 英文产品名走正则抽取，不需要登记在这里。

const DICT = [
  // 大模型与厂商
  '豆包', '通义', '千问', '文心', '混元', '星火', '盘古',
  '月之暗面', 'Kimi', '智谱', '面壁', '阶跃星辰', '深度求索',
  // 应用与工具
  '扣子', '即梦', '可灵', '海螺', '秘塔', '纳米搜索',
  // 公司
  '字节跳动', '阿里巴巴', '腾讯', '百度', '美团', '小红书',
  '快手', '哔哩哔哩', '商汤', '旷视',
];

// 冷启动兜底停用词。文章数 < 50 时 df 统计不稳，用它挡掉泛词。
// 文章数够了之后 df 过滤会接管，但这张表始终生效（两个条件同时判）。
const STOPWORDS = new Set([
  'ai', 'app', 'api', 'ios', 'android', 'web', 'http', 'https',
  'com', 'cn', 'net', 'org', 'www', 'html', 'css', 'js',
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'are',
  'llm', 'agent', 'gpt', 'model', 'chat', 'pro', 'max', 'plus',
  'ceo', 'cto', 'ui', 'ux', 'sdk', 'saas', 'pc', 'vr', 'ar',
  // 英文虚词。正文里到处都是，一旦某篇密度稍高就会把不相干的文章连起来。
  // （实测：「机器人在日本火了」曾靠 all / above 连上「Apple 收割者」）
  'all', 'above', 'about', 'after', 'again', 'also', 'any', 'are', 'been',
  'before', 'best', 'but', 'can', 'from', 'get', 'has', 'have', 'her',
  'his', 'how', 'into', 'its', 'just', 'like', 'made', 'make', 'more',
  'most', 'new', 'not', 'now', 'one', 'only', 'our', 'out', 'over',
  'said', 'see', 'she', 'some', 'than', 'them', 'then', 'there', 'they',
  'time', 'two', 'use', 'very', 'was', 'way', 'were', 'what', 'when',
  'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
  // 泛技术词。是话题不是对象，命中它们不代表讲了同一件事。
  'vision', 'data', 'cloud', 'code', 'coding', 'agents', 'agentic',
  'prompt', 'token', 'tokens', 'demo', 'beta', 'alpha', 'team', 'tech',
  'video', 'audio', 'image', 'text', 'chatbot', 'copilot', 'assistant',
  'startup', 'vc', 'ipo', 'saas', 'api', 'gpu', 'cpu', 'chip',
]);

module.exports = { DICT, STOPWORDS };
