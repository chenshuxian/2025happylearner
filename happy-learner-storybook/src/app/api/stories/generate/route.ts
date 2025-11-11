import { NextResponse } from 'next/server';
import { generateStoryContent } from '../../../../../lib/storyGenerator';
import { generateAudio } from '../../../../../lib/audioGenerator';
import { generateVideo } from '../../../../../lib/videoGenerator';
import { saveStoryToDatabase, initializeDatabaseSchema, StoryContent } from '../../../../../lib/db';

/**
 * @module StoryGenerationAPI
 * @description API Route Handler for triggering automated story generation.
 */

/**
 * Handles POST requests to trigger story generation.
 * This endpoint is intended to be called by a scheduled job.
 * It requires a secret key for authorization to prevent unauthorized access.
 *
 * @param {Request} request - The incoming Next.js request object.
 * @returns {Promise<NextResponse>} A promise that resolves to a Next.js response indicating success or failure.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const secretKey = process.env.CRON_SECRET_KEY;

  if (!secretKey) {
    console.error('CRON_SECRET_KEY is not set in environment variables.');
    return NextResponse.json({ message: 'Server configuration error.' }, { status: 500 });
  }

  if (!authHeader || authHeader !== `Bearer ${secretKey}`) {
    console.warn('Unauthorized attempt to access story generation API.');
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('Starting automated story generation process...');

    // Ensure database schema is initialized
    await initializeDatabaseSchema();

    const storiesToGenerate = 2;
    const generatedStories: { story: StoryContent; audioUrls: string[]; videoUrl: string }[] = [];

    for (let i = 0; i < storiesToGenerate; i++) {
      console.log(`Generating story ${i + 1} of ${storiesToGenerate}...`);
      try {
        // 1. Generate Story Content
        const storyContent = await generateStoryContent(`adventure story ${Date.now()}`); // Use a dynamic topic
        console.log(`Story content generated for "${storyContent.title}".`);

        // 2. Generate Audio for each page
        const audioUrls: string[] = [];
        for (const page of storyContent.pages) {
          const storyId = storyContent.title.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now(); // Unique ID for story
          const audioUrl = await generateAudio(page.text, storyId, page.pageNumber);
          audioUrls.push(audioUrl);
          console.log(`Generated audio for page ${page.pageNumber}: ${audioUrl}`);
        }

        // 3. Generate Video for the entire story
        const storyIdForVideo = storyContent.title.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now();
        const videoUrl = await generateVideo(storyIdForVideo, storyContent.pages, audioUrls);
        console.log(`Generated video for "${storyContent.title}": ${videoUrl}`);

        // 4. Save to Database
        await saveStoryToDatabase(storyContent, audioUrls, videoUrl);
        console.log(`Story "${storyContent.title}" and associated media saved to database.`);

        generatedStories.push({ story: storyContent, audioUrls, videoUrl });

      } catch (storyError: any) {
        console.error(`Error generating single story:`, storyError);
        // Continue to next story even if one fails
      }
    }

    if (generatedStories.length === 0) {
      return NextResponse.json({ message: 'No stories were successfully generated.' }, { status: 500 });
    }

    console.log(`Automated story generation process completed. Generated ${generatedStories.length} stories.`);
    return NextResponse.json({ message: `Successfully generated ${generatedStories.length} stories.`, stories: generatedStories }, { status: 200 });

  } catch (error: any) {
    console.error('Overall automated story generation process failed:', error);
    return NextResponse.json({ message: 'Failed to generate stories.', error: error.message }, { status: 500 });
  }
}