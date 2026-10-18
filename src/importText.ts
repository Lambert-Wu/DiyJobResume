import { parseMarkdown, uid } from "./flow";
import type { Line } from "./flow";

// 把「从 Word / 聊天记录里复制来的一大段简历」尽量还原成结构化行。
// 规则只做保守识别，认不出的内容一律当普通正文，不丢字。

const SECTION_NAMES = [
  "个人总结",
  "自我评价",
  "个人优势",
  "个人简介",
  "求职意向",
  "项目经历",
  "实习经历",
  "工作经历",
  "校园经历",
  "教育背景",
  "专业技能",
  "技能特长",
  "证书/其他",
  "证书 / 其他",
  "证书",
  "荣誉奖项",
  "获奖情况",
  "其他",
];

const BULLET = /^[·•●○◦▪▫‣⁃∙※+*\-–—]\s*/;
const ENTRY_MARK = /^[►▶▸▹➤◆◇■□]\s*/;
const DATE = /(?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2}/;
const CONTACT_HINT = /(@|电话|手机|邮箱|微信|现居|住址|地址|求职意向|📱|📧)/;

const tidy = (value: string) =>
  value.replace(/[\t\u3000]+/g, " ").replace(/ {2,}/g, "  ").trim();

const cellsOf = (value: string) =>
  value
    .split(/\s{2,}|\s*[｜|]\s*/)
    .map((cell) => cell.trim())
    .filter(Boolean);

function entryText(value: string) {
  const cells = cellsOf(value);
  if (!cells.length) return value;
  // 四段以上（学校 / 专业 / 学历 / 时间）合并中间几段，保持「左 | 中 | 右」
  return cells.length >= 4
    ? `${cells[0]} | ${cells.slice(1, -1).join(" ")} | ${cells[cells.length - 1]}`
    : cells.join(" | ");
}

export function textToLines(raw: string): Line[] {
  const rows = raw.replace(/\r\n?/g, "\n").split("\n");
  const lines: Line[] = [];
  let nameTaken = false,
    contactTaken = false;

  for (const source of rows) {
    const row = tidy(source.replace(/^[\s\u3000]+/, ""));
    if (!row) continue;

    const section = /^【\s*(.+?)\s*】$/.exec(row);
    if (section) {
      lines.push({ id: uid(), kind: "section", text: section[1] });
      continue;
    }

    if (BULLET.test(row)) {
      const text = row.replace(BULLET, "").trim();
      if (text) lines.push({ id: uid(), kind: "bullet", text });
      continue;
    }

    // 姓名：第一行、没有冒号/分隔符、不含数字，也不是板块名
    if (
      !nameTaken &&
      !lines.length &&
      row.length <= 24 &&
      !/[：:|｜/\d]/.test(row) &&
      !SECTION_NAMES.includes(row)
    ) {
      lines.push({ id: uid(), kind: "name", text: row });
      nameTaken = true;
      continue;
    }

    // 联系方式：出现在最前面，且带 @ / 电话 / 邮箱 / 现居等关键词
    if (!contactTaken && lines.length <= 2 && CONTACT_HINT.test(row)) {
      lines.push({ id: uid(), kind: "text", text: row });
      contactTaken = true;
      continue;
    }

    if (SECTION_NAMES.includes(row)) {
      lines.push({ id: uid(), kind: "section", text: row });
      continue;
    }

    // 经历行：「► 标题  角色  时间」或「学校  专业  学历  时间」
    if (ENTRY_MARK.test(row) || DATE.test(row)) {
      const body = row.replace(ENTRY_MARK, "").trim();
      if (body) {
        lines.push({ id: uid(), kind: "entry", text: entryText(body) });
        continue;
      }
    }

    lines.push({ id: uid(), kind: "text", text: row });
  }

  return lines;
}

// 判断一段文字是「markdown 写法」还是「从文档里复制来的原始排版」。
// 只看有没有 # 标题：从 Word 复制来的稿子常用 - 或 · 当项目符号，
// 如果按 markdown 解析，姓名和【板块】就会被当成普通正文。
export function looksLikeMarkdown(text: string) {
  return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(text);
}

// 判断用户发来的这一段是不是「整份简历」而不是一句指令。
// 用来在模型没给出方案时兜底：本地直接按规则排，不让用户白等。
export function looksLikeResumeBlock(text: string) {
  const rows = text.split("\n").filter((row) => row.trim());
  if (rows.length < 5) return false;
  return /【.+?】/.test(text) || /[►▶]/.test(text) || /(^|\n)\s*[·•]/.test(text);
}

// markdown 写法交给 flow 的解析器（同一套规则，不重复实现）
export function contentToLines(text: string): Line[] {
  return looksLikeMarkdown(text) ? parseMarkdown(text) : textToLines(text);
}
