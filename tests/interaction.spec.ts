import { test, expect } from '@playwright/test';

test('wheel keeps settled values on taps and micro drags; confirmation saves current value', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.gallery-strip')).toBeVisible();
    const toggle = page.locator('.meta-toggle');
    if (await toggle.evaluate(e => e.classList.contains('on'))) await toggle.click();
    const trigger = page.locator('.meta-time-input');
    await trigger.click();
    const seconds = page.getByRole('spinbutton', { name: 'วินาที', exact: true });
    const minutes = page.getByRole('spinbutton', { name: 'นาที', exact: true });
    const oldMinute = await minutes.getAttribute('aria-valuenow');
    const oldSecond = await seconds.getAttribute('aria-valuenow');
    const b = (await seconds.boundingBox())!;
    await page.mouse.move(b.x+b.width/2,b.y+30);
    await page.mouse.down();
    await page.mouse.move(b.x+b.width/2,b.y+34);
    await page.mouse.up();
    await expect(seconds).toHaveAttribute('aria-valuenow', oldSecond!);
    await seconds.focus();
    await page.keyboard.press('ArrowDown');
    await expect(seconds).toHaveAttribute('aria-valuenow', String((Number(oldSecond)+1)%60));
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
    await page.mouse.down();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2-53,{steps:8});
    await page.waitForTimeout(120);
    await page.mouse.up();
    await expect(seconds).toHaveAttribute('aria-valuenow', String((Number(oldSecond)+2)%60));
    await expect(minutes).toHaveAttribute('aria-valuenow',oldMinute!);
    await page.locator('.datetime-picker-actions .btn-primary').click();
    await trigger.click();
    await expect(seconds).toHaveAttribute('aria-valuenow', String((Number(oldSecond)+2)%60));
    await page.locator('.datetime-picker-actions .btn-secondary').click();
});

test('hardware shutter event uses capture path only when camera is ready and no modal is open', async ({ page }) => {
    await page.goto('/');
    const shutter = page.locator('.shutter-btn');
    await expect(shutter).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event('native-hardware-shutter')));
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    await page.locator('.thumbnail').first().click();
    await page.evaluate(() => window.dispatchEvent(new Event('native-hardware-shutter')));
    await page.waitForTimeout(350);
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    await page.locator('.preview-modal .modal-header button').click();
    await page.getByTitle('ปิดกล้อง', {exact:true}).click();
    await expect(shutter).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event('native-hardware-shutter')));
    await page.waitForTimeout(350);
    await expect(page.locator('.thumbnail')).toHaveCount(1);
});

test('camera shutter feedback and stable aspect ratio on camera toggle', async ({page}) => {
    await page.goto('/');
    const video = page.locator('.viewfinder video');
    const frame = page.locator('.viewfinder');
    const shutter = page.locator('.shutter-btn');
    await expect(shutter).toBeEnabled();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
    const before = (await frame.boundingBox())!;
    expect(before.width/before.height).toBeCloseTo(.75,1);
    await page.evaluate(() => {
        const w = window as any;
        w.captures = [];
        for (const name of ['timestamp-capture-start','timestamp-capture-saved'])
            window.addEventListener(name, () => w.captures.push(name));
    });
    await shutter.click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => (window as any).captures)).toEqual(['timestamp-capture-start','timestamp-capture-saved']);
    await expect(shutter).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event('native-hardware-shutter')));
    await expect(page.locator('.thumbnail')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => (window as any).captures)).toEqual(['timestamp-capture-start','timestamp-capture-saved','timestamp-capture-start','timestamp-capture-saved']);
    await page.getByTitle('ปิดกล้อง',{exact:true}).click();
    await expect(shutter).toBeDisabled();
    const off = (await frame.boundingBox())!;
    expect(off.width).toBeCloseTo(before.width,0);
    expect(off.height).toBeCloseTo(before.height,0);
    await page.getByTitle('เปิดกล้อง',{exact:true}).click();
    await expect(shutter).toBeEnabled();
    await expect(page.locator('.camera-zoom-indicator')).toHaveText('1.0×');
});
test('camera pinch zoom changes saved crop and resets to 1x', async ({page, context, isMobile}) => {
    test.skip(!isMobile,'Real multi-touch uses the mobile project');
    await page.goto('/');
    const video = page.locator('.viewfinder video'), frame = page.locator('.viewfinder');
    const shutter = page.locator('.shutter-btn'), zoom = page.locator('.camera-zoom-indicator');
    await expect(shutter).toBeEnabled();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
    await shutter.click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    const b = (await frame.boundingBox())!, x=b.x+b.width/2,y=b.y+b.height/2;
    const cdp = await context.newCDPSession(page);
    const touch = (d:number) => [{x:x-d,y,id:1},{x:x+d,y,id:2}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touch(25)});
    for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touch(25+25*i/8)});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(zoom).toHaveText('2.0×');
    await expect(video).toHaveAttribute('data-capture-zoom','2');
    await shutter.click();
    await expect(page.locator('.thumbnail')).toHaveCount(2);
    const widths = await page.locator('.thumbnail img').evaluateAll(async (images:HTMLImageElement[]) => {
        await Promise.all(images.map(img => img.decode()));
        return images.map(img => img.naturalWidth);
    });
    expect(widths[1]).toBeCloseTo(widths[0]/2,0);
    await zoom.click();
    await expect(zoom).toHaveText('1.0×');
    await expect(video).toHaveAttribute('data-capture-zoom','1');
    await cdp.detach();
});

test('capture flight uses a paced animation and leaves shutter available',async({page})=>{
    await page.goto('/');
    const shutter=page.locator('.shutter-btn');
    await expect(shutter).toBeEnabled();
    await expect.poll(()=>page.locator('.viewfinder video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2);
    await page.evaluate(()=>{
        const animate=Element.prototype.animate;
        (window as any).flightDurations=[];
        (window as any).flightMotion=[];
        Element.prototype.animate=function(...args:Parameters<Element['animate']>){
            if(this.classList.contains('capture-flight') && Array.isArray(args[0]) && args[0].some(k=>k.transform)) {
                (window as any).flightDurations.push(typeof args[1]==='number'?args[1]:args[1]?.duration);
                (window as any).flightMotion.push({frames:args[0],easing:typeof args[1]==='object'?args[1]?.easing:''});
            }
            return animate.apply(this,args);
        };
    });
    await shutter.click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    await expect.poll(()=>page.evaluate(()=>(window as any).flightDurations)).toEqual([620]);
    const motion=await page.evaluate(()=>(window as any).flightMotion[0]);
    expect(motion.frames).toHaveLength(2);
    expect(motion.frames[0].transform).toBe('translate3d(0,0,0) scale(1)');
    expect(motion.easing).toBe('cubic-bezier(.32,.12,.24,1)');
    await expect(shutter).toBeEnabled();
    await expect(page.locator('.capture-flight')).toHaveCount(0);
    await page.emulateMedia({reducedMotion:'reduce'});
    await shutter.click();
    await expect(page.locator('.thumbnail')).toHaveCount(2);
    expect(await page.evaluate(()=>(window as any).flightDurations)).toEqual([620]);
});

test('camera toolbar positions and overflow menu support touch, outside dismissal and Back',async({page})=>{
    await page.goto('/');
    await expect(page.locator('.gallery-strip')).toBeVisible();
    const top=page.locator('.topbar'), bottom=page.locator('.action-buttons');
    const more=top.getByRole('button',{name:'เมนูเพิ่มเติม',exact:true});
    const torch=bottom.getByTitle('แฟลช',{exact:true});
    await expect(top.getByTitle('แฟลช',{exact:true})).toHaveCount(0);
    await expect(bottom.getByTitle('นำเข้ารูป',{exact:true})).toHaveCount(0);
    await expect(top.getByTitle('ตั้งค่า',{exact:true})).toHaveCount(0);
    await expect(top.getByTitle('ถังขยะ',{exact:true})).toHaveCount(0);
    expect(await top.locator('.topbar-right button').evaluateAll(buttons=>buttons.map(b=>b.title))).toEqual(['ดาวน์โหลดทั้งหมด','นำเข้ารูป','เมนูเพิ่มเติม']);
    expect(await bottom.locator('button').evaluateAll(buttons=>buttons.map(b=>b.title))).toEqual(['แฟลช','ถ่ายรูป','สลับกล้อง']);
    await expect(torch).toHaveAttribute('aria-pressed','false');
    await page.getByTitle('ปิดกล้อง',{exact:true}).click();
    await expect(torch).toBeDisabled();
    await expect(top.getByTitle('นำเข้ารูป',{exact:true})).toBeEnabled();
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded','true');
    const panel=page.locator('.topbar-more-panel');
    await expect(panel.getByRole('button',{name:'ตั้งค่า',exact:true})).toBeFocused();
    await page.evaluate(()=>window.dispatchEvent(new Event('native-app-back')));
    await expect(panel).toHaveCount(0);
    await expect(more).toBeFocused();
    await more.click();
    await page.locator('.topbar-menu-scrim').click({position:{x:8,y:200}});
    await expect(panel).toHaveCount(0);
    await more.click();
    await panel.getByRole('button',{name:'ตั้งค่า',exact:true}).click();
    await expect(page.locator('.settings-modal')).toBeVisible();
    await expect(panel).toHaveCount(0);
    await page.evaluate(()=>window.dispatchEvent(new Event('native-app-back')));
    await more.click();
    await panel.getByRole('button',{name:'ถังขยะ',exact:true}).click();
    await expect(page.locator('.trash-modal')).toBeVisible();
    await expect(panel).toHaveCount(0);
});
