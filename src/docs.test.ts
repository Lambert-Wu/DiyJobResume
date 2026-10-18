import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOCS_KEY,
  blankResume,
  loadLibrary,
  saveLibrary,
  uniqueName,
} from "./docs";
import { STORAGE_KEY, initialResume } from "./flow";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resume library", () => {
  it("migrates the old single draft into the list", () => {
    const old = initialResume();
    old.name = "老草稿";
    const store = memoryStorage({ [STORAGE_KEY]: JSON.stringify(old) });
    vi.stubGlobal("localStorage", store);

    const { library } = loadLibrary();
    expect(library.items).toHaveLength(1);
    expect(library.items[0].name).toBe("老草稿");
    expect(library.activeId).toBe(library.items[0].id);
    // 迁移后立刻落盘，下次刷新走新结构
    expect(store.dump()[DOCS_KEY]).toContain("老草稿");
  });

  it("keeps every stored resume and repairs a bad active id", () => {
    const a = initialResume(),
      b = initialResume();
    a.name = "A";
    b.name = "B";
    const store = memoryStorage({
      [DOCS_KEY]: JSON.stringify({
        activeId: "missing",
        items: [
          { id: "a", name: "A", updatedAt: 2, doc: a },
          { id: "b", name: "B", updatedAt: 1, doc: b },
          { id: "broken", name: "坏数据", doc: null },
        ],
      }),
    });
    vi.stubGlobal("localStorage", store);

    const { library } = loadLibrary();
    expect(library.items.map((item) => item.name)).toEqual(["A", "B"]);
    expect(library.activeId).toBe("a");
  });

  it("writes the active document without touching the others", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    const first = initialResume();
    const library = {
      activeId: "x",
      items: [
        { id: "x", name: "X", updatedAt: 1, doc: first },
        { id: "y", name: "Y", updatedAt: 1, doc: first },
      ],
    };
    saveLibrary(library);
    const saved = JSON.parse(store.dump()[DOCS_KEY] ?? "{}");
    expect(saved.items).toHaveLength(2);
    expect(saved.activeId).toBe("x");
  });

  it("gives new resumes a distinct default name", () => {
    expect(uniqueName(["未命名简历"], "未命名简历")).toBe("未命名简历 2");
    expect(uniqueName(["未命名简历", "未命名简历 2"], "未命名简历")).toBe(
      "未命名简历 3",
    );
  });

  it("starts a blank resume with only the basics", () => {
    const doc = blankResume("blue", "空简历");
    expect(doc.name).toBe("空简历");
    expect(doc.lines[0].kind).toBe("name");
    expect(doc.lines.length).toBeLessThan(6);
    expect(doc.pictures).toEqual([]);
  });
});
