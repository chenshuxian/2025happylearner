import { StoryContent, StoryPage } from '../types/story.d';

/**
 * 根據主題生成故事內容，包含10頁故事文本和10個精選單字。
 * 故事內容和單字應簡單易懂，適合0-6歲小朋友。
 * 每頁單字數量應在50個字以內。
 *
 * @param topic 故事的主題。
 * @returns 包含故事標題、每頁故事文本和精選單字的 Promise。
 * @throws 如果 LLM API 呼叫失敗，則拋出錯誤。
 */
export async function generateStoryContent(topic: string): Promise<StoryContent> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_API_KEY is not defined in environment variables.');
  }

  // 這裡應該替換為實際的 LLM API 呼叫邏輯
  // 為了示範，我們將模擬一個回應
  console.log(`Calling LLM API with topic: ${topic}`);

  // 模擬 LLM API 回應
  const mockLLMResponse = {
    title: `The Adventures of ${topic}`,
    pages: [
      { pageNumber: 1, text: `Once upon a time, there was a little ${topic}. It loved to play.` },
      { pageNumber: 2, text: `One sunny morning, the ${topic} saw a big, red ball. It was so round!` },
      { pageNumber: 3, text: `The ${topic} rolled the ball. Roll, roll, roll! It went very fast.` },
      { pageNumber: 4, text: `Suddenly, a friendly bird flew by. Chirp, chirp! The bird sang a song.` },
      { pageNumber: 5, text: `The ${topic} and the bird played together. They laughed and had fun.` },
      { pageNumber: 6, text: `Then, a fluffy cloud appeared. It looked like a soft, white sheep.` },
      { pageNumber: 7, text: `The ${topic} waved goodbye to the cloud. See you soon, cloud!` },
      { pageNumber: 8, text: `It was getting late. The sun began to set, painting the sky orange.` },
      { pageNumber: 9, text: `The little ${topic} felt happy and tired. What a wonderful day!` },
      { pageNumber: 10, text: `The ${topic} went home and slept soundly, dreaming of new adventures.` },
    ],
    vocabulary: ['little', 'play', 'sunny', 'ball', 'roll', 'bird', 'sang', 'cloud', 'happy', 'home'],
  };

  // 實際應用中，這裡會解析 LLM 的回應並提取故事內容和單字
  // 確保 LLM 的 Prompt 能夠生成符合「10頁、每頁50字以內、適合0-6歲小朋友、精選10個單字」的格式
  const storyContent: StoryContent = {
    title: mockLLMResponse.title,
    pages: mockLLMResponse.pages,
    vocabulary: mockLLMResponse.vocabulary,
  };

  return storyContent;
}