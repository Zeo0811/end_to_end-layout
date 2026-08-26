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
]);

module.exports = { DICT, STOPWORDS };
