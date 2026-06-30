import { prisma } from '@/lib/db';

(async () => {
  const total = await prisma.feed.count();
  const withId = await prisma.feed.count({ where: { channel_id: { not: null } } });
  const withoutId = await prisma.feed.count({ where: { channel_id: null } });

  const samples = await prisma.feed.findMany({
    where: { channel_id: { not: null } },
    select: { channel_id: true, channel_name: true },
    distinct: ['channel_id'],
    take: 50,
    orderBy: { channel_name: 'asc' },
  });

  console.log('=== channel_id 统计 ===');
  console.log('总帖子:', total);
  console.log('有 channel_id:', withId);
  console.log('无 channel_id:', withoutId);
  console.log('');

  console.log('=== 有 channel_id 的样本 (前50个) ===');
  for (const s of samples) {
    const isNum = /^\d+$/.test(s.channel_id || '');
    const note = isNum ? '' : ' ⚠️ 非数字!';
    console.log(`  channel_id:${s.channel_id}  name:${s.channel_name}${note}`);
  }

  const allDistinct = await prisma.feed.findMany({
    where: { channel_id: { not: null } },
    select: { channel_id: true },
    distinct: ['channel_id'],
  });
  const nonNum = allDistinct.filter(s => !/^\d+$/.test(s.channel_id || ''));
  if (nonNum.length > 0) {
    console.log('');
    console.log(`⚠️ 发现 ${nonNum.length} 个非数字 channel_id:`);
    nonNum.forEach(s => console.log('  ', s.channel_id));
  } else {
    console.log('');
    console.log('✅ 所有 channel_id 都是数字');
  }

  const noIdSamples = await prisma.feed.findMany({
    where: { channel_id: null, channel_name: { not: null } },
    select: { channel_name: true },
    distinct: ['channel_name'],
    take: 50,
    orderBy: { channel_name: 'asc' },
  });
  console.log('');
  console.log('=== 无 channel_id 的版块名称 (前50个) ===');
  noIdSamples.forEach(s => console.log('  channel_name:', s.channel_name));

  await prisma.$disconnect();
})().catch(e => { console.error(e); prisma.$disconnect(); });
