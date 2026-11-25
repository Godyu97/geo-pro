# competitors

固定竞品集与已观察提及的份额在 `commands.ts` 和 `competitor-share/rules.ts`。同一回答里每个品牌只计一次，在共同可判断子集里分别计算题等权份额与池化份额；零提及题保持 N/A 并保留覆盖，缺失题目编号的回答不进入等权均值，竞品集换版后分段，无序输出不产生名次。

来源复核记在 `source_inspection`：页面不可读或失效时引用仍在，支持性为 unknown。研究 Brief 拒绝只替换品牌名的文案，并保留来源 ID。双语页面在 `/dashboard/monitoring/competitors`。这里不抓取外部页面，也不把份额显示成排名。
