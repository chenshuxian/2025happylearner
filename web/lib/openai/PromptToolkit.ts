import type {
	StoryGenerationPayload,
	StoryScriptResult,
	TranslationResult,
} from './types';

/**
 * PromptToolkit 提供故事腳本、翻譯與精選單字的 Prompt 模板與占位符注入。
 */
export class PromptToolkit {
	/**
	 * 產生故事腳本 Prompt。
	 * @param payload 故事主題、語氣與年齡設定。
	 * @param previousStory 可選，先前故事摘要供重生使用。
	 */
	getStoryScriptPrompt(
		payload: StoryGenerationPayload,
		previousStory?: Pick<StoryScriptResult, 'synopsisEn'>
	) {
		return [
			{
				role: 'system' as const,
				content: `You are a children's story author for ages ${payload.ageRange}.
IMPORTANT (STRICT): Return ONLY a single valid JSON object and NOTHING ELSE — no explanatory text, no headings, no markdown, no code fences. The JSON must be JSON.parse()-able. Do NOT include surrounding backticks or delimiters. If you cannot produce valid JSON, return {"error":"unable_to_produce_json"}.

To make parsing robust for downstream systems, return the JSON as a SINGLE LINE with internal newlines escaped (use \\n for line breaks inside strings). Use double quotes for all strings and escape any internal double quotes (e.g. use \\\" inside values). Avoid raw unescaped newlines or unescaped quotes.

Produce an engaging, wholesome picture-book style story suitable for children aged ${payload.ageRange}. The story MUST have exactly 10 pages. Each page should be concise (recommended ≤ 50 words). Use simple vocabulary, a friendly tone, and include a positive moral.

The JSON MUST match this exact structure (single-line, escaped newlines and escaped quotes inside string values):
{"title_en": string, "synopsis_en": string, "pages": [{"page_number": number, "text_en": string, "summary_en": string}]}

If your model cannot produce strictly formatted JSON, return {"error":"unable_to_produce_json"} and NOTHING ELSE. Ensure content is safe for kids; avoid violence, fear, or adult themes.`,
			},
			{
				role: 'user' as const,
				content: JSON.stringify({
					theme: payload.theme,
					tone: payload.tone,
					previousSynopsis: previousStory?.synopsisEn,
				}),
			},
		];
	}

	/**
	 * 產生中文翻譯 Prompt。
	 * @param story 故事英文內容。
	 */
	getTranslationPrompt(story: StoryScriptResult) {
		return [
			{
				role: 'system' as const,
				content: `You are a bilingual translator converting English children's stories into Traditional Chinese (zh-TW).
IMPORTANT (STRICT): Return ONLY a single valid JSON object and NOTHING ELSE — no commentary, no markdown, no extra text. The JSON must be JSON.parse()-able. Return the JSON as a SINGLE LINE with internal newlines escaped (use \\n). Use double quotes and escape any internal double quotes (use \\\" inside values). Avoid raw newline characters inside string values.

Maintain the meaning, simplicity, and warm tone suitable for children aged 0-6.

The JSON MUST match this exact structure (single-line, escaped newlines and escaped quotes inside string values):
{"title_zh": string, "synopsis_zh": string, "pages": [{"page_number": number, "text_zh": string, "notes_zh": string}]}

If you cannot output strict JSON, respond with {"error":"unable_to_produce_json"} only.`,
			},
			{
				role: 'user' as const,
				content: JSON.stringify({
					title_en: story.titleEn,
					synopsis_en: story.synopsisEn,
					pages: story.pages.map((page) => ({
						page_number: page.pageNumber,
						text_en: page.textEn,
					})),
				}),
			},
		];
	}

	/**
	 * 產生精選單字 Prompt。
	 * @param translation 翻譯後的故事內容，供模型提供中英文對照。
	 */
	getVocabularyPrompt(translation: TranslationResult) {
		return [
			{
				role: 'system' as const,
				content: `You are an English teacher selecting vocabulary for young learners (ages 0-6).
IMPORTANT (STRICT): Return ONLY a single valid JSON object and NOTHING ELSE — no surrounding text, no markdown, no code fences. The JSON must be JSON.parse()-able. Return the JSON as a SINGLE LINE with internal newlines escaped (use \\n). Use double quotes and escape internal double quotes (use \\\" inside values). Avoid raw newline characters inside string values. If you cannot produce valid JSON, return {"error":"unable_to_produce_json"} only.

Extract EXACTLY 10 child-friendly words from the given story.

The JSON MUST match this exact structure (single-line, escaped newlines and escaped quotes inside string values):
{"entries":[{"word":string,"part_of_speech":string,"definition_en":string,"definition_zh":string,"example_sentence":string,"example_translation":string,"cefr_level":string}]}

Definitions and translations must be simple and age-appropriate. Keep examples short and clear.`,
			},
			{
				role: 'user' as const,
				content: JSON.stringify({
					title_zh: translation.titleZh,
					synopsis_zh: translation.synopsisZh,
					pages: translation.pages.map((page) => ({
						page_number: page.pageNumber,
						text_zh: page.textZh,
					})),
				}),
			},
		];
	}
}
