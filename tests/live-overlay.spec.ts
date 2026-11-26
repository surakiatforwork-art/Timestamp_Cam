import { test, expect } from '@playwright/test';

test('live overlay updates clock only, stops when camera off and leaves capture responsive',async({page})=>{
    await page.addInitScript(()=>{
        localStorage.setItem('timestamp-settings',JSON.stringify({globalTimeMode:'now',timestampFormat:'iso',locationEnabled:true,showLatLng:true,latitude:13.85,longitude:100.53,showRemark:true,defaultRemark:'Live test'}));
        const original=CanvasRenderingContext2D.prototype.fillText;
        const calls:{layer:string;text:string}[]=[];
        (window as any).liveCalls=calls;
        CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
            if(this.canvas.className.startsWith('live-overlay-'))calls.push({layer:this.canvas.className,text});
            return original.call(this,text,x,y,...rest);
        };
    });
    await page.goto('/');
    const calls=()=>page.evaluate(()=>(window as any).liveCalls as {layer:string;text:string}[]);
    await expect.poll(async()=> (await calls()).some(c=>c.text.includes('Live test'))).toBe(true);
    const first=await calls();
    expect(first.some(c=>c.text.includes('13.850000'))).toBe(true);
    const staticCount=first.filter(c=>c.layer==='live-overlay-location').length;
    const initialTimes=first.filter(c=>c.layer==='live-overlay-time').map(c=>c.text);
    await expect.poll(async()=> (await calls()).filter(c=>c.layer==='live-overlay-time').length).toBeGreaterThan(initialTimes.length);
    expect((await calls()).filter(c=>c.layer==='live-overlay-location')).toHaveLength(staticCount);
    await expect(page.locator('.shutter-btn')).toBeEnabled();
    await page.locator('.shutter-btn').click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    const liveSize=await page.locator('.live-overlay-output').evaluate(el=>({w:Number((el as HTMLElement).dataset.outputWidth),h:Number((el as HTMLElement).dataset.outputHeight)}));
    const stored=await page.evaluate(async()=>{const {db}=await import('/src/lib/legacyDb.ts');const p=(await db.photos.toArray())[0];return {w:p.width,h:p.height};});
    expect(liveSize).toEqual(stored);
    await page.getByTitle('ปิดกล้อง',{exact:true}).click();
    await expect(page.locator('.live-overlay-output')).toHaveCount(0);
    const count=(await calls()).length;
    await page.waitForTimeout(1200);
    expect(await calls()).toHaveLength(count);
});

test('legacy custom time is migrated to now; preset contain preserves boundary',async({page})=>{
    await page.addInitScript(()=>{
        localStorage.setItem('timestamp-settings',JSON.stringify({globalTimeMode:'custom',globalCustomTime:'2026-10-15T03:15:59.000Z',timestampFormat:'iso',outputMode:'preset',presetSize:{w:1920,h:1080},fitMode:'contain',locationEnabled:false,showRemark:true,defaultRemark:'Preset check'}));
        const original=CanvasRenderingContext2D.prototype.fillText;
        (window as any).liveCalls=[];
        CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
            if(this.canvas.className.startsWith('live-overlay-'))(window as any).liveCalls.push(text);
            return original.call(this,text,x,y,...rest);
        };
    });
    await page.goto('/');
    const overlay=page.locator('.live-overlay-output'), source=page.locator('.camera-source'), vf=page.locator('.viewfinder');
    await expect(overlay).toHaveAttribute('data-output-width','1920');
    await expect.poll(()=>page.evaluate(()=>(window as any).liveCalls.some((t:string)=>t.includes('Preset check')))).toBe(true);
    const a=(await overlay.boundingBox())!,b=(await source.boundingBox())!,c=(await vf.boundingBox())!;
    expect(a.width/a.height).toBeCloseTo(1920/1080,1);
    expect(b.width/b.height).toBeCloseTo(c.width/c.height,1);
    expect(b.width).toBeLessThan(a.width);
    expect(b.height).toBeCloseTo(a.height,0);
    const count=await page.evaluate(()=>(window as any).liveCalls.length);
    await page.waitForTimeout(1250);
    expect(await page.evaluate(()=>(window as any).liveCalls.length)).toBeGreaterThan(count);
    await page.locator('.shutter-btn').click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    const saved=await page.evaluate(async()=>{const {db}=await import('/src/lib/legacyDb.ts');const p=(await db.photos.toArray())[0];return {time:p.timeValueISO,mode:p.timeMode,created:p.createdAtISO};});
    expect(saved.mode).toBe('now');expect(saved.time).toBe(saved.created);expect(Math.abs(Date.now()-Date.parse(saved.time))).toBeLessThan(10000);
    await page.locator('.thumbnail').first().click();
    await expect(page.locator('.active-preview-canvas')).toBeVisible();
    const size=await page.locator('.active-preview-canvas').evaluate((c:HTMLCanvasElement)=>({w:c.width,h:c.height}));
    expect(size.w/size.h).toBeCloseTo(1920/1080,1);
});

test('GPS live overlay follows new fixes, freezes capture and import metadata, stops when disabled',async({page,context})=>{
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({latitude:13.75,longitude:100.5,accuracy:5});
    await page.addInitScript(()=>{
        localStorage.setItem('timestamp-settings',JSON.stringify({globalTimeMode:'custom',globalCustomTime:'2020-01-01T00:00:00Z',locationMode:'gps',locationEnabled:true,showLatLng:true,showAddress:true,showDistrict:false,showProvince:false,timestampFormat:'iso'}));
        const original=CanvasRenderingContext2D.prototype.fillText;
        (window as any).locCalls=[];
        CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
            if(this.canvas.className==='live-overlay-location')(window as any).locCalls.push(text);
            return original.call(this,text,x,y,...rest);
        };
    });
    await page.route('https://nominatim.openstreetmap.org/reverse?**',route=>route.fulfill({json:{display_name:'Test address',address:{district:'Test district'}}}));
    await page.goto('/');
    const seen=(s:string)=>page.evaluate(s=>(window as any).locCalls.some((t:string)=>t.includes(s)),s);
    await expect.poll(()=>seen('13.750000, 100.500000')).toBe(true);
    await expect.poll(()=>seen('Test address')).toBe(true);
    await page.locator('.shutter-btn').click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    await context.setGeolocation({latitude:13.76,longitude:100.51,accuracy:5});
    await expect.poll(()=>seen('13.760000, 100.510000')).toBe(true);
    // Exercise the same import event emitted by the gallery picker, with a synthetic image.
    await page.evaluate(async()=>{
        const c=document.createElement('canvas');c.width=32;c.height=32;
        const b=await new Promise<Blob>(r=>c.toBlob(v=>r(v!),'image/png'));
        window.dispatchEvent(new CustomEvent('import-files',{detail:[new File([b],'live-test.png',{type:'image/png'})]}));
    });
    await expect(page.locator('.thumbnail')).toHaveCount(2);
    const records=await page.evaluate(async()=>{const {db}=await import('/src/lib/legacyDb.ts');return (await db.photos.toArray()).map(p=>({source:p.sourceName,lat:p.locationLatitude,lng:p.locationLongitude,address:p.locationAddress,time:p.timeValueISO,created:p.createdAtISO,mode:p.timeMode}));});
    const camera=records.find(p=>p.source==='camera')!, imported=records.find(p=>p.source==='live-test.png')!;
    expect(camera.lat).toBeCloseTo(13.75,5);expect(camera.address).toBe('Test address');
    expect(imported.lat).toBeCloseTo(13.76,5);expect(imported.lng).toBeCloseTo(100.51,5);expect(imported.address).toBeNull();
    for(const r of records){expect(r.mode).toBe('now');expect(r.time).toBe(r.created);expect(Math.abs(Date.now()-Date.parse(r.time))).toBeLessThan(20000);}
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ตั้งค่า',{exact:true}).click();
    await page.locator('.settings-home').getByRole('button',{name:'ตำแหน่ง',exact:true}).click();
    await page.getByRole('switch',{name:'เปิดใช้งานตำแหน่ง'}).click();
    await page.getByRole('button',{name:'ปิดการตั้งค่า'}).click();
    await context.setGeolocation({latitude:13.77,longitude:100.52,accuracy:5});
    await page.waitForTimeout(1300);
    expect(await seen('13.770000')).toBe(false);
});

test('zoom cycles 1x 2x 3x without resizing or repainting static stamp; export keeps proportional layout',async({page})=>{
    await page.addInitScript(()=>{
        localStorage.setItem('timestamp-settings',JSON.stringify({timestampFormat:'iso',locationMode:'manual',locationEnabled:true,showLatLng:true,latitude:13.85,longitude:100.53,showRemark:true,defaultRemark:'Long remark with several words for stable wrapping',fontMode:'fixed',fontFixedPx:32,overlayPadding:26,locationFrame:{x:.15,y:.25,width:.7,height:.7}}));
        const original=CanvasRenderingContext2D.prototype.fillText;
        (window as any).stampCalls=[];
        CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
            if(this.canvas.className==='live-overlay-location')(window as any).stampCalls.push(text);
            return original.call(this,text,x,y,...rest);
        };
    });
    await page.goto('/');
    const overlay=page.locator('.live-overlay-output'),button=page.locator('.camera-zoom-indicator'),video=page.locator('.viewfinder video');
    await expect.poll(()=>page.evaluate(()=>(window as any).stampCalls.length)).toBeGreaterThan(1);
    const snapshot=()=>overlay.evaluate(el=>{
        const c=el.querySelector<HTMLCanvasElement>('.live-overlay-location')!,r=el.getBoundingClientRect();
        return {w:c.width,h:c.height,width:r.width,height:r.height,x:r.x,y:r.y,pixels:c.toDataURL(),calls:[...(window as any).stampCalls],refW:Number((el as HTMLElement).dataset.outputWidth),refH:Number((el as HTMLElement).dataset.outputHeight)};
    });
    const first=await snapshot();
    await expect(button).toHaveText('1.0×');
    for(const level of [2,3,1]){
        await button.click();
        await expect(button).toHaveText(level.toFixed(1)+'×');
        await expect(video).toHaveAttribute('data-capture-zoom',String(level));
        await page.waitForTimeout(100);
        expect(await snapshot()).toEqual(first);
    }
    await page.locator('.shutter-btn').click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    await button.click();
    await page.locator('.shutter-btn').click();
    await expect(page.locator('.thumbnail')).toHaveCount(2);
    const result=await page.evaluate(async()=>{
        const {db}=await import('/src/lib/legacyDb.ts');
        const {renderPhotoToCanvas}=await import('/src/lib/canvas.ts');
        const {loadSettings}=await import('/src/lib/settings.ts');
        const settings=loadSettings();
        const photos=(await db.photos.toArray()).sort((a,b)=>b.width-a.width);
        const measurements=[];
        for(const p of photos){
            const seen:{text:string;size:number;x:number;y:number}[]=[];
            const old=CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
                if(!this.canvas.className){const m=this.getTransform();seen.push({text,size:parseFloat(this.font.match(/([0-9.]+)px/)![1])/this.canvas.width,x:m.e/this.canvas.width,y:m.f/this.canvas.height});}
                return old.call(this,text,x,y,...rest);
            };
            try{
                const canvas=await renderPhotoToCanvas({...p,thumbUrl:''},settings);
                measurements.push({w:canvas.width,h:canvas.height,refW:p.overlayReferenceWidth,refH:p.overlayReferenceHeight,seen:seen.filter(x=>!x.text.includes('Network:')&&!x.text.includes('Local:'))});
            }finally{CanvasRenderingContext2D.prototype.fillText=old;}
        }
        return measurements;
    });
    expect(result[0].w).toBeCloseTo(result[1].w*2,0);
    expect(result[0].refW).toBe(result[1].refW);
    expect(result[0].refH).toBe(result[1].refH);
    expect(result[0].seen.map(x=>x.text)).toEqual(result[1].seen.map(x=>x.text));
    for(let i=0;i<result[0].seen.length;i++){
        expect(result[1].seen[i].size).toBeCloseTo(result[0].seen[i].size,3);
        expect(result[1].seen[i].x).toBeCloseTo(result[0].seen[i].x,2);
        expect(result[1].seen[i].y).toBeCloseTo(result[0].seen[i].y,2);
    }
});
