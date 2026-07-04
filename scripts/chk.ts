import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

async function main() {
  const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const fid = 'B_34b0476a215c02001441152190993331670X60';
  const feed = await p.feed.findUnique({ where: { feed_id: fid } });
  console.log('feed found:', !!feed);
  
  // Test the API handler directly via fetch-like approach
  // Just verify the feed ID can be found
  const apiUrl = `http://localhost:3000/api/feeds/${encodeURIComponent(fid)}`;
  console.log('API URL would be:', apiUrl);
  console.log('Encoded fid:', encodeURIComponent(fid));
  
  await p.$disconnect();
}
main().catch(console.error);
