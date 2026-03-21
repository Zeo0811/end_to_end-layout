// 微信公众号 API 封装（多账号版本）
// 通过 createClient(appId, appSecret) 创建独立实例，各自维护 token 缓存

function createClient(appId, appSecret) {
  if (!appId || !appSecret) {
    throw new Error('未提供 appId 或 appSecret');
  }

  let tokenCache = { token: null, expiresAt: 0 };
  let tokenRefreshing = null; // 防止并发刷新

  async function getAccessToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
      return tokenCache.token;
    }
    // 防止并发请求同时刷新 token
    if (tokenRefreshing) return tokenRefreshing;
    tokenRefreshing = _refreshToken();
    try { return await tokenRefreshing; } finally { tokenRefreshing = null; }
  }

  async function _refreshToken() {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.errcode) {
      throw new Error(`获取 access_token 失败: [${data.errcode}] ${data.errmsg}`);
    }
    tokenCache = {
      token:     data.access_token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    };
    console.log(`[WeChat:${appId.slice(-4)}] access_token refreshed, expires_in: ${data.expires_in}`);
    return data.access_token;
  }

  function invalidateToken() {
    tokenCache = { token: null, expiresAt: 0 };
  }

  // 带 token 过期自动重试的 API 调用包装
  async function apiCallWithRetry(fn) {
    try {
      return await fn();
    } catch (e) {
      // 40001/42001 = token 过期/无效，刷新后重试一次
      if (e.message && /\[4000[12]\]|\[4200[12]\]/.test(e.message)) {
        console.log(`[WeChat:${appId.slice(-4)}] token 过期，刷新重试...`);
        invalidateToken();
        return await fn();
      }
      throw e;
    }
  }

  // ── multipart/form-data 构造（零依赖）──
  function buildMultipart(fields) {
    const boundary = '----WeChatUpload' + Date.now() + Math.random().toString(36).slice(2);
    const parts = [];
    for (const f of fields) {
      let header = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
      if (f.filename) {
        header += `; filename="${f.filename}"`;
        header += `\r\nContent-Type: ${f.contentType || 'application/octet-stream'}`;
      }
      header += '\r\n\r\n';
      parts.push(Buffer.from(header));
      parts.push(Buffer.isBuffer(f.value) ? f.value : Buffer.from(String(f.value)));
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return {
      body:        Buffer.concat(parts),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  async function uploadArticleImage(imageBuffer, filename, mimeType) {
    return apiCallWithRetry(async () => {
      const token = await getAccessToken();
      const url   = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`;
      const { body, contentType } = buildMultipart([
        { name: 'media', filename: filename || 'image.jpg', contentType: mimeType || 'image/jpeg', value: imageBuffer },
      ]);
      const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body });
      const data = await res.json();
      if (data.errcode) throw new Error(`上传文章图片失败: [${data.errcode}] ${data.errmsg}`);
      return data.url;
    });
  }

  async function uploadPermanentImage(imageBuffer, filename, mimeType) {
    return apiCallWithRetry(async () => {
      const token = await getAccessToken();
      const url   = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`;
      const { body, contentType } = buildMultipart([
        { name: 'media', filename: filename || 'thumb.jpg', contentType: mimeType || 'image/jpeg', value: imageBuffer },
      ]);
      const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body });
      const data = await res.json();
      if (data.errcode) throw new Error(`上传永久素材失败: [${data.errcode}] ${data.errmsg}`);
      return { media_id: data.media_id, url: data.url };
    });
  }

  async function createDraft(articles) {
    return apiCallWithRetry(async () => {
      const token = await getAccessToken();
      const url   = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`;
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ articles }),
      });
      const data = await res.json();
      if (data.errcode) throw new Error(`创建草稿失败: [${data.errcode}] ${data.errmsg}`);
      return data.media_id;
    });
  }

  function extractImagesFromHtml(html) {
    const images = [];
    const regex = /<img\s[^>]*src="([^"]+)"[^>]*>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      images.push({ fullMatch: match[0], src: match[1] });
    }
    return images;
  }

  function base64ToBuffer(dataUrl) {
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    return { buffer: Buffer.from(m[2], 'base64'), mimeType: m[1] };
  }

  // 微信上传图片大小限制：文章图片接口 10MB
  const IMAGE_SIZE_LIMIT = 10 * 1024 * 1024;
  // GIF 大小限制：超过此值则压缩
  const GIF_SIZE_LIMIT = 5 * 1024 * 1024;

  function mimeToExt(mime) {
    const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
    return map[mime] || '.jpg';
  }

  // 压缩 GIF 到目标大小（通过逐步缩小尺寸）
  async function compressGif(gifBuffer, targetSize) {
    const sharp = require('sharp');
    const metadata = await sharp(gifBuffer, { animated: true }).metadata();
    const origWidth = metadata.width || 800;
    const origHeight = metadata.pageHeight || metadata.height || 600;

    // 逐步缩小到 90%、80%、...、30%，直到小于目标大小
    for (let scale = 0.9; scale >= 0.3; scale -= 0.1) {
      const w = Math.round(origWidth * scale);
      const h = Math.round(origHeight * scale);
      try {
        const compressed = await sharp(gifBuffer, { animated: true })
          .resize(w, h)
          .gif()
          .toBuffer();
        console.log(`[WeChat] GIF 压缩 ${Math.round(scale * 100)}% → ${(compressed.length / 1024 / 1024).toFixed(2)}MB`);
        if (compressed.length <= targetSize) {
          return { buffer: compressed, mime: 'image/gif' };
        }
      } catch (e) {
        console.warn(`[WeChat] GIF 压缩失败 (scale=${scale}):`, e.message);
        break;
      }
    }
    return null;
  }

  async function processHtmlImages(html, onProgress) {
    const images = extractImagesFromHtml(html);
    if (images.length === 0) return { html, firstImageBuffer: null, firstImageMime: null };

    let processedHtml    = html;
    let firstImageBuffer = null;
    let firstImageMime   = null;
    let uploaded = 0;

    // 先准备所有图片的 buffer（并发下载）
    const prepared = await Promise.all(images.map(async (img) => {
      try {
        if (img.src.startsWith('data:')) {
          const parsed = base64ToBuffer(img.src);
          return parsed ? { src: img.src, buffer: parsed.buffer, mime: parsed.mimeType } : null;
        } else if (img.src.startsWith('http')) {
          const resp = await fetch(img.src, { signal: AbortSignal.timeout(30000) });
          if (!resp.ok) return null;
          return {
            src: img.src,
            buffer: Buffer.from(await resp.arrayBuffer()),
            mime: resp.headers.get('content-type') || 'image/jpeg',
          };
        }
      } catch (err) {
        console.error('图片下载失败:', img.src.slice(0, 80), err.message);
      }
      return null;
    }));

    // 并发上传到微信（最多 3 张同时）
    const CONCURRENCY = 3;
    const valid = prepared.filter(Boolean);

    for (let i = 0; i < valid.length; i += CONCURRENCY) {
      const batch = valid.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(async (img, j) => {
        const idx = i + j;
        if (!firstImageBuffer) {
          firstImageBuffer = img.buffer;
          firstImageMime   = img.mime;
        }

        let uploadBuffer = img.buffer;
        let uploadMime = img.mime;
        const sizeMB = (uploadBuffer.length / 1024 / 1024).toFixed(2);
        const isGif = uploadMime === 'image/gif';

        // GIF 超过 5MB 则压缩
        if (isGif && uploadBuffer.length > GIF_SIZE_LIMIT) {
          console.warn(`[WeChat] GIF 图片 #${idx} 超过 5MB (${sizeMB}MB)，开始压缩...`);
          const compressed = await compressGif(uploadBuffer, GIF_SIZE_LIMIT);
          if (compressed) {
            uploadBuffer = compressed.buffer;
            uploadMime = compressed.mime;
            console.log(`[WeChat] GIF 压缩完成: ${(uploadBuffer.length / 1024 / 1024).toFixed(2)}MB`);
          } else {
            console.error(`[WeChat] GIF 图片 #${idx} (${sizeMB}MB) 压缩失败，跳过上传`);
            return null;
          }
        } else if (isGif) {
          console.log(`[WeChat] GIF 图片 #${idx}: ${sizeMB}MB`);
        }

        // 非 GIF 图片超过 10MB 限制则跳过
        if (!isGif && uploadBuffer.length > IMAGE_SIZE_LIMIT) {
          console.error(`[WeChat] 图片 #${idx} (${sizeMB}MB) 超过微信 10MB 限制，跳过上传`);
          return null;
        }

        const filename = `img_${idx}${mimeToExt(uploadMime)}`;
        const wechatUrl = await uploadArticleImage(uploadBuffer, filename, uploadMime);
        return { src: img.src, wechatUrl };
      }));

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          // replaceAll 确保同一张图多次出现都被替换
          processedHtml = processedHtml.split(r.value.src).join(r.value.wechatUrl);
          uploaded++;
        } else if (r.status === 'rejected') {
          console.error('图片上传失败:', r.reason?.message);
        }
      }
      if (onProgress) onProgress(uploaded, valid.length);
    }

    return { html: processedHtml, firstImageBuffer, firstImageMime };
  }

  async function uploadVideo(videoBuffer, filename, title, description) {
    const token = await getAccessToken();
    const url   = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=video`;
    const descJson = JSON.stringify({ title: title || '视频', introduction: description || '' });
    const { body, contentType } = buildMultipart([
      { name: 'media',       filename: filename || 'video.mp4', contentType: 'video/mp4', value: videoBuffer },
      { name: 'description', value: descJson },
    ]);
    const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType }, body });
    const data = await res.json();
    if (data.errcode) throw new Error(`上传视频失败: [${data.errcode}] ${data.errmsg}`);
    console.log('[WeChat] 视频上传成功, media_id:', data.media_id);
    return data.media_id;
  }

  async function processHtmlVideos(html) {
    const videoRegex = /<section\s[^>]*data-video-src="([^"]*)"[^>]*>[\s\S]*?<\/section>/gi;
    const matches = [];
    let match;
    while ((match = videoRegex.exec(html)) !== null) {
      const videoUrl = match[1];
      if (!videoUrl) continue;
      const thumbMatch = match[0].match(/data-video-thumb="([^"]*)"/);
      const cookiesMatch = match[0].match(/data-video-cookies="([^"]*)"/);
      matches.push({
        fullMatch: match[0],
        videoUrl,
        thumbUrl: thumbMatch ? thumbMatch[1] : '',
        cookies: cookiesMatch ? cookiesMatch[1] : '',
      });
    }

    if (matches.length === 0) return html;

    let processedHtml = html;
    for (const m of matches) {
      try {
        console.log('[WeChat] 下载视频:', m.videoUrl.slice(0, 100));
        const fetchHeaders = {};
        if (m.cookies) fetchHeaders['Cookie'] = m.cookies;
        const resp = await fetch(m.videoUrl, { redirect: 'follow', signal: AbortSignal.timeout(120000), headers: fetchHeaders });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const videoBuffer = Buffer.from(await resp.arrayBuffer());
        const sizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
        console.log(`[WeChat] 视频大小: ${sizeMB}MB`);

        if (videoBuffer.length > 20 * 1024 * 1024) {
          console.warn('[WeChat] 视频超过 20MB 限制，跳过上传');
          continue;
        }

        const mediaId = await uploadVideo(videoBuffer, 'video.mp4', '视频', '');

        let thumbCoverUrl = '';
        if (m.thumbUrl && m.thumbUrl.startsWith('http')) {
          try {
            const thumbResp = await fetch(m.thumbUrl);
            if (thumbResp.ok) {
              const thumbBuf  = Buffer.from(await thumbResp.arrayBuffer());
              const thumbMime = thumbResp.headers.get('content-type') || 'image/jpeg';
              thumbCoverUrl = await uploadArticleImage(thumbBuf, 'video_cover.jpg', thumbMime);
            }
          } catch (e) {
            console.warn('[WeChat] 视频封面上传失败:', e.message);
          }
        }

        const embedHtml = `<mpvideo vid="${mediaId}" cover="${thumbCoverUrl}" title="视频" desc=""></mpvideo>`;
        processedHtml = processedHtml.replace(m.fullMatch, embedHtml);
        console.log('[WeChat] 视频嵌入成功, media_id:', mediaId);
      } catch (err) {
        console.error('[WeChat] 视频处理失败:', err.message);
      }
    }

    return processedHtml;
  }

  async function publishArticle({ title, author, html, digest, thumbBuffer, thumbMime }) {
    console.log('[WeChat] 开始处理正文图片...');
    const { html: imgProcessedHtml, firstImageBuffer, firstImageMime } = await processHtmlImages(html);

    console.log('[WeChat] 开始处理正文视频...');
    const processedHtml = await processHtmlVideos(imgProcessedHtml);

    let thumbMediaId;
    const coverBuffer = thumbBuffer || firstImageBuffer;
    const coverMime   = thumbMime   || firstImageMime;
    if (coverBuffer) {
      console.log('[WeChat] 上传封面图...');
      const thumbResult = await uploadPermanentImage(coverBuffer, 'thumb' + mimeToExt(coverMime), coverMime);
      thumbMediaId = thumbResult.media_id;
    } else {
      throw new Error('没有可用的封面图片，请确保文章中包含至少一张图片');
    }

    console.log('[WeChat] 创建草稿...');
    const article = {
      title:              title || '未命名文章',
      author:             author || '',
      content:            processedHtml,
      digest:             digest || '',
      thumb_media_id:     thumbMediaId,
      need_open_comment:  0,
      only_fans_can_comment: 0,
    };
    const mediaId = await createDraft([article]);
    console.log('[WeChat] 草稿创建成功, media_id:', mediaId);
    return { media_id: mediaId };
  }

  async function deleteDraft(mediaId) {
    return apiCallWithRetry(async () => {
      const token = await getAccessToken();
      const url   = `https://api.weixin.qq.com/cgi-bin/draft/delete?access_token=${token}`;
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ media_id: mediaId }),
      });
      const data = await res.json();
      if (data.errcode) throw new Error(`删除草稿失败: [${data.errcode}] ${data.errmsg}`);
      console.log('[WeChat] 草稿已删除, media_id:', mediaId);
    });
  }

  return {
    getAccessToken,
    uploadArticleImage,
    uploadPermanentImage,
    uploadVideo,
    createDraft,
    deleteDraft,
    processHtmlImages,
    processHtmlVideos,
    publishArticle,
  };
}

module.exports = { createClient };
