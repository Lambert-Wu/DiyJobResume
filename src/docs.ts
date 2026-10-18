import {
  OLD_KEY,
  STORAGE_KEY,
  initialResume,
  parseMarkdown,
  readResume,
  uid,
} from "./flow";
import type { Resume, Template } from "./flow";

// 多份简历存在同一个键里：避免每份简历各占一个 localStorage 键，
// 也方便一次性读写、避免切换时漏存。
export const DOCS_KEY = "diyjobresume.docs.v1";

export interface DocEntry {
  id: string;
  name: string;
  updatedAt: number;
  doc: Resume;
}
export interface DocLibrary {
  activeId: string;
  items: DocEntry[];
}

const now = () => Date.now();

export function makeEntry(doc: Resume, name = doc.name): DocEntry {
  return { id: uid(), name, updatedAt: now(), doc };
}

export function blankResume(template: Template, name: string): Resume {
  const doc = initialResume(template);
  return {
    ...doc,
    name,
    // 只留姓名和联系方式，方便直接开始写
    lines: parseMarkdown("# 姓名\n手机 | 邮箱\n## 教育背景\n## 实习经历"),
  };
}

export function cloneResume(doc: Resume, name: string): Resume {
  const copy = JSON.parse(JSON.stringify(doc)) as Resume;
  return { ...copy, name };
}

export function uniqueName(taken: string[], base: string) {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function normalizeEntry(raw: unknown): DocEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<DocEntry>;
  if (!item.doc) return null;
  try {
    const doc = readResume(item.doc);
    return {
      id: String(item.id || uid()),
      name: String(item.name || doc.name || "未命名简历").slice(0, 60),
      updatedAt: Number(item.updatedAt) || now(),
      doc,
    };
  } catch {
    return null;
  }
}

function write(library: DocLibrary) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(library));
  } catch {
    /* 存不下时交给上层的保存失败提示 */
  }
}

// 读取简历列表；老版本只有单份文档，这里自动装进列表，用户不会丢稿。
export function loadLibrary(): { library: DocLibrary; notice: string } {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DocLibrary>;
      const items = Array.isArray(parsed.items)
        ? parsed.items.map(normalizeEntry).filter((x): x is DocEntry => !!x)
        : [];
      if (items.length) {
        const activeId = items.some((i) => i.id === parsed.activeId)
          ? String(parsed.activeId)
          : items[0].id;
        return { library: { activeId, items }, notice: "" };
      }
    }
  } catch {
    /* 损坏就尝试从旧键恢复，下面统一处理 */
  }
  let doc: Resume | null = null,
    notice = "";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) doc = readResume(JSON.parse(saved));
    else {
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        doc = readResume(JSON.parse(old));
        notice =
          "已迁移旧版文字与图片，原草稿仍保留。旧版自由色块不转入正文。";
      }
    }
  } catch {
    notice = "草稿读取失败，原始数据仍保留。请先导出旧稿或导入备份。";
  }
  const first = makeEntry(doc || initialResume());
  const library = { activeId: first.id, items: [first] };
  write(library);
  return { library, notice };
}

export function saveLibrary(library: DocLibrary) {
  write(library);
}
