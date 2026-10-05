import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const bytes = await readFile('WhatsApp Video 2026-10-05 at 7.52.34 AM.mp4');
const server = createServer((req, res) => {
  if (req.url === '/video.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length }); res.end(bytes); }
  else { res.writeHead(200, {'Content-Type': 'text/html'}); res.end('<video id="video" src="/video.mp4" muted preload="auto"></video>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const meta = await page.evaluate(() => { const v = document.querySelector('video'); return {width:v.videoWidth,height:v.videoHeight,duration:v.duration}; });
  console.log(meta);
  await mkdir('test-results/video-review', {recursive:true});
  const frames = await page.evaluate(async ({duration}) => {
    const v = document.querySelector('video');
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    const frames = [];
    for(let time = 0; time < duration; time += 0.5) {
      if(time !== 0) { v.currentTime = time; await new Promise(resolve => v.addEventListener('seeked',resolve,{once:true})); }
      ctx.drawImage(v, 0, 0); frames.push({time, data:canvas.toDataURL('image/png').split(',')[1]});
    }
    return frames;
  }, meta);
  for(const frame of frames) await writeFile(`test-results/video-review/frame-${frame.time.toFixed(1)}.png`, Buffer.from(frame.data,'base64'));
  const contact = await page.evaluate(async frames => {
    const canvas = document.createElement('canvas'); const w=480,h=300;
    canvas.width=w*4; canvas.height=h*Math.ceil(frames.length/4);
    const ctx = canvas.getContext('2d'); ctx.fillStyle='#d4d4d4';ctx.fillRect(0,0,canvas.width,canvas.height);
    for(let i=0;i<frames.length;i++) {
      const img = new Image(); img.src='data:image/png;base64,'+frames[i].data; await img.decode();
      const scale = Math.min(w/img.width, (h-24)/img.height);
      const x=(i%4)*w,y=Math.floor(i/4)*h;
      ctx.drawImage(img,x,y+24,img.width*scale,img.height*scale);
      ctx.fillStyle='#000';ctx.font='18px Arial';ctx.fillText(frames[i].time.toFixed(1)+'s',x+5,y+20);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  },frames);
  await writeFile('test-results/video-review/contact.png',Buffer.from(contact,'base64'));
} finally { await browser.close(); server.close(); }
