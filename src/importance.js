export const MAJOR_THRESHOLD = 4;

const rules = [
  {
    points: 5,
    reason: "突发事件",
    pattern: /突发|紧急|熔断|停牌|交易暂停|违约|破产|战争|军事行动|制裁|重大事故|系统性风险|breaking|emergency|circuit breaker|trading halt|default|bankrupt|war|military action|sanction|systemic risk/i,
  },
  {
    points: 4,
    reason: "宏观决策",
    pattern: /降息|加息|利率决议|货币政策决定|存款准备金|FOMC声明|非农就业|国内生产总值|CPI|GDP|interest rate decision|rate cut|rate hike|monetary policy decision|reserve requirement|nonfarm payroll/i,
  },
  {
    points: 4,
    reason: "重大监管",
    pattern: /出口管制|芯片禁令|反垄断|重大处罚|立案调查|监管新规|关税上调|export control|chip ban|antitrust|major penalty|formal investigation|new regulation|tariff increase/i,
  },
  {
    points: 3,
    reason: "公司事件",
    pattern: /重大收购|重大并购|盈利预警|业绩暴雷|大规模召回|首次公开募股|major acquisition|megadeal|profit warning|earnings miss|mass recall|initial public offering|\bIPO\b/i,
  },
  {
    points: 4,
    reason: "科技风险",
    pattern: /零日漏洞|重大漏洞|大规模数据泄露|云服务中断|关键基础设施攻击|zero-day|critical vulnerability|massive data breach|cloud outage|critical infrastructure attack/i,
  },
];

export function assessImportance(item) {
  const text = `${item.title || ""} ${item.summary || ""} ${item.titleOriginal || ""}`;
  let score = 0;
  const reasons = [];

  if (item.official) {
    score += 1;
    reasons.push("官方来源");
  }
  if (["政策", "监管", "经济"].includes(item.category)) score += 1;
  if (Number(item.relevance || 0) > 0) {
    score += 2;
    reasons.push("关注命中");
  }
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      score += rule.points;
      reasons.push(rule.reason);
    }
  }

  return {
    score,
    level: score >= 7 ? "critical" : score >= MAJOR_THRESHOLD ? "major" : "normal",
    reasons: [...new Set(reasons)],
  };
}
