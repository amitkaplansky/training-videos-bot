import { google } from 'googleapis';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = 'Sheet1';

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(await fs.readFile('./credentials.json', 'utf8')),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

export async function getAllTags(): Promise<string[]> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!C2:C`,
  });

  const rows = res.data.values || [];
  const tags = new Set<string>();

  rows.forEach((row: string[]) => {
    const cell = row[0];
    if (cell) {
      cell.split(',').forEach((tag: string) => tags.add(tag.trim().toLowerCase()));
    }
  });

  return Array.from(tags);
}

export async function getVideosByTag(tag: string, count: number) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:C`,
  });

  const rows = res.data.values || [];
  const filtered = rows.filter(row => row[2]?.toLowerCase().includes(tag.toLowerCase()));
  const shuffled = filtered.sort(() => 0.5 - Math.random());

  return shuffled.slice(0, count).map(row => ({
    title: row[0],
    url: row[1],
    tags: row[2],
  }));
}

export async function addVideo(title: string, url: string, tags: string) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:C`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[title, url, tags]],
    },
  });
}

export async function isDuplicateUrl(url: string): Promise<boolean> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!B2:B`,
  });

  const urls = res.data.values?.flat() || [];
  return urls.includes(url);
}
