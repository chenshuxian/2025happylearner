/**
 * @file Database connection setup.
 * @description This file contains the PostgreSQL database connection logic using the 'pg' library.
 */

import { Pool, QueryResult } from 'pg';

/**
 * Database configuration object, loaded from environment variables.
 * @type {object}
 * @property {string} host - Database host.
 * @property {number} port - Database port.
 * @property {string} user - Database user.
 * @property {string} password - Database password.
 * @property {string} database - Database name.
 */
export const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'happy_learner_storybook',
};

/**
 * PostgreSQL connection pool.
 * @type {Pool}
 */
const pool = new Pool(dbConfig);

/**
 * Connects to the PostgreSQL database and returns a client from the pool.
 * @returns {Promise<PoolClient>} A promise that resolves to a PostgreSQL client.
 * @throws {Error} If the database connection fails.
 */
export async function connectToDatabase() {
  try {
    const client = await pool.connect();
    console.log('Database connection established successfully.');
    return client;
  } catch (error) {
    console.error('Failed to connect to the database:', error);
    throw new Error('Database connection failed.');
  }
}

/**
 * Executes a SQL query against the database.
 * @template T - The type of the rows returned by the query.
 * @param {string} text - The SQL query string.
 * @param {any[]} [params] - An optional array of query parameters.
 * @returns {Promise<QueryResult<T>>} A promise that resolves to the query result.
 * @throws {Error} If the query execution fails.
 */
export async function query<T>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const client = await connectToDatabase();
  try {
    return await client.query<T>(text, params);
  } catch (error) {
    console.error('Error executing query:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Represents the structure of a story page.
 * @interface StoryPage
 * @property {number} pageNumber - The page number.
 * @property {string} text - The text content of the page.
 */
export interface StoryPage {
  pageNumber: number;
  text: string;
}

/**
 * Represents the content of a story.
 * @interface StoryContent
 * @property {string} title - The title of the story.
 * @property {StoryPage[]} pages - An array of story pages.
 * @property {string[]} vocabulary - An array of selected vocabulary words.
 */
export interface StoryContent {
  title: string;
  pages: StoryPage[];
  vocabulary: string[];
}

/**
 * Saves a generated story, its audio URLs, and video URL to the PostgreSQL database.
 * @param {StoryContent} story - The generated story content.
 * @param {string[]} audioUrls - An array of URLs for each page's audio.
 * @param {string} videoUrl - The URL of the complete story video.
 * @returns {Promise<void>} A promise that resolves when the story is successfully saved.
 * @throws {Error} If the story saving process fails.
 */
export async function saveStoryToDatabase(
  story: StoryContent,
  audioUrls: string[],
  videoUrl: string
): Promise<void> {
  const { title, pages, vocabulary } = story;
  const insertQuery = `
    INSERT INTO stories (title, content, audio_urls, video_url)
    VALUES ($1, $2, $3, $4)
    RETURNING id;
  `;
  try {
    const result = await query<{ id: number }>(insertQuery, [
      title,
      JSON.stringify({ pages, vocabulary }), // Store pages and vocabulary as JSONB
      JSON.stringify(audioUrls),
      videoUrl,
    ]);
    console.log(`Story "${title}" saved to database with ID: ${result.rows[0].id}`);
  } catch (error) {
    console.error(`Failed to save story "${title}" to database:`, error);
    throw new Error(`Failed to save story "${title}" to database.`);
  }
}

/**
 * Initializes the database schema by creating the 'stories' table if it doesn't exist.
 * The 'stories' table will store story content, audio URLs, video URL, and creation timestamp.
 * It uses a JSONB column for flexible storage of story content, audio URLs, and video URL.
 * @returns {Promise<void>} A promise that resolves when the schema is initialized.
 * @throws {Error} If the schema initialization fails.
 */
export async function initializeDatabaseSchema(): Promise<void> {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS stories (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      content JSONB NOT NULL,
      audio_urls JSONB NOT NULL,
      video_url VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await query(createTableQuery);
    console.log('Database schema initialized: "stories" table ensured.');
  } catch (error) {
    console.error('Failed to initialize database schema:', error);
    throw new Error('Database schema initialization failed.');
  }
}