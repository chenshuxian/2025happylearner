export interface StoryPage {
  pageNumber: number;
  text: string;
}

export interface StoryContent {
  title: string;
  pages: StoryPage[];
  vocabulary: string[]; // 精選的10個單字
}