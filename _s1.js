const crawler = require('./parsers/crawler');
(async () => {
  const t0 = Date.now();
  try {
    const r = await crawler.crawl('https://capable-terrier-0f2.notion.site/AI-3d292b15f5c4810c9416f0e2db3d8829');
    const imgs = r.blocks.filter(b => b.type === 'image');
    console.log(`成功 ${((Date.now()-t0)/1000).toFixed(0)}s | 块 ${r.blocks.length} | 图 ${imgs.length} | 有图注 ${imgs.filter(b=>b.caption).length}`);
  } catch (e) {
    console.log(`失败 ${((Date.now()-t0)/1000).toFixed(0)}s |`, e.message.split('\n')[0].slice(0,60));
  }
  await crawler.closeBrowser();
})();
