'use client';
import React, { useState } from "react";

/**
 * Dev test page for story generation and vocab interaction.
 *
 * - Can call POST /api/generation/story-script OR use a local mock response toggle.
 * - Shows result and allows marking favorite vocabulary
 *
 * This file adds a "Use mock response" switch so front-end UI can be validated
 * without requiring the full backend DB / Upstash stack to be operational.
 */
const MOCK_RESPONSE = {
  ok: true,
  storyId: "mock-story-123",
  result: {
    story: {
      titleEn: "Mock: The Friendly Dragon",
      synopsisEn: "A short mock story about a friendly dragon.",
      pages: [
        { pageNumber: 1, textEn: "Daisy the dragon likes to share.", summaryEn: "Daisy shares." },
        { pageNumber: 2, textEn: "She makes friends by being kind.", summaryEn: "Kindness wins friends." },
        { pageNumber: 3, textEn: "They play in the meadow.", summaryEn: "Playtime." }
      ],
    },
    translation: {
      titleZh: "模擬：友善的龍",
      synopsisZh: "一個友善的龍的簡短模擬故事。",
      pages: [
        { pageNumber: 1, textZh: "黛西這隻龍喜歡分享。", notesZh: "" },
        { pageNumber: 2, textZh: "她用善良交到朋友。", notesZh: "" },
        { pageNumber: 3, textZh: "他們在草地上玩耍。", notesZh: "" }
      ],
    },
    vocabulary: {
      entries: [
        { word: "dragon", partOfSpeech: "noun", definitionEn: "A big magical creature.", definitionZh: "一種有魔法的大生物。", exampleSentence: "The dragon shares apples.", exampleTranslation: "龍分享蘋果。", cefrLevel: "A1" },
        { word: "friend", partOfSpeech: "noun", definitionEn: "Someone you like.", definitionZh: "你喜歡的人。", exampleSentence: "Daisy has a friend.", exampleTranslation: "黛西有一個朋友。", cefrLevel: "A1" }
      ]
    }
  },
  createdJobIds: ["mock-job-1", "mock-job-2"]
};

export default function DevTestPage() {
  const [theme, setTheme] = useState("A friendly dragon");
  const [tone, setTone] = useState("warm");
  const [ageRange, setAgeRange] = useState("0-6");
  const [useMock, setUseMock] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  /**
   * Send request to generate story and persist it.
   *
   * If useMock is true, use local MOCK_RESPONSE to allow frontend verification
   * even when DB / Upstash are not available in dev.
   */
  async function handleGenerate() {
    setError(null);
    setLoading(true);
    setResult(null);

    try {
      if (useMock) {
        // small delay to mimic network
        await new Promise((r) => setTimeout(r, 300));
        setResult(MOCK_RESPONSE);
        const vocabEntries = MOCK_RESPONSE.result?.vocabulary?.entries ?? [];
        const fav: Record<string, boolean> = {};
        vocabEntries.forEach((e: any) => (fav[e.word] = false));
        setFavorites(fav);
        return;
      }

      const resp = await fetch("/api/generation/story-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, tone, ageRange }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error ?? "生成失敗");
      }
      setResult(data);
      const vocabEntries = data?.result?.vocabulary?.entries ?? [];
      const fav: Record<string, boolean> = {};
      vocabEntries.forEach((e: any) => (fav[e.word] = false));
      setFavorites(fav);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Toggle favorite state for a vocab word.
   *
   * @param word vocab word
   */
  function toggleFavorite(word: string) {
    setFavorites((prev) => ({ ...prev, [word]: !prev[word] }));
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial" }}>
      <h1>Dev: Story Generation Test</h1>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 4 }}>Use mock response (dev)</label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} />
          <span style={{ fontSize: 13, color: "#666" }}>Toggle mock — when ON the page uses a local response and does not call backend</span>
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 4 }}>Theme</label>
        <input value={theme} onChange={(e) => setTheme(e.target.value)} style={{ width: "100%", padding: 8 }} />
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", marginBottom: 4 }}>Tone</label>
          <input value={tone} onChange={(e) => setTone(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </div>
        <div style={{ width: 160 }}>
          <label style={{ display: "block", marginBottom: 4 }}>Age Range</label>
          <input value={ageRange} onChange={(e) => setAgeRange(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <button onClick={handleGenerate} disabled={loading} style={{ padding: "8px 16px" }}>
          {loading ? "Generating..." : "Generate Story"}
        </button>
      </div>
      {error && <div style={{ color: "red", marginBottom: 12 }}>{error}</div>}

      {result && (
        <div>
          <h2>Result</h2>
          <div style={{ marginBottom: 8 }}>
            <strong>StoryId:</strong> {result.storyId}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Title:</strong> {result.result?.story?.titleEn}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Pages:</strong>
            <ol>
              {result.result?.story?.pages?.map((p: any) => (
                <li key={p.pageNumber} style={{ marginBottom: 6 }}>
                  <div><em>EN:</em> {p.textEn}</div>
                  <div><em>ZH:</em> {result.result?.translation?.pages?.find((tp: any) => tp.pageNumber === p.pageNumber)?.textZh}</div>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h3>Vocabulary</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {result.result?.vocabulary?.entries?.map((e: any) => (
                <div key={e.word} style={{ border: "1px solid #ddd", padding: 8, borderRadius: 6, minWidth: 180 }}>
                  <div style={{ fontWeight: 700 }}>{e.word}</div>
                  <div style={{ fontSize: 13, color: "#555" }}>{e.partOfSpeech}</div>
                  <div style={{ marginTop: 6 }}>{e.definitionEn}</div>
                  <div style={{ marginTop: 6, color: "#333" }}>{e.definitionZh}</div>
                  <div style={{ marginTop: 6 }}>
                    <button onClick={() => toggleFavorite(e.word)} style={{ padding: "4px 8px" }}>
                      {favorites[e.word] ? "★ Favorited" : "☆ Favorite"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <h4>Created Generation Job IDs</h4>
            <pre style={{ background: "#f7f7f7", padding: 12, borderRadius: 6 }}>{JSON.stringify(result.createdJobIds, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}