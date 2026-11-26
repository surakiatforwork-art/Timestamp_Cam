import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page, active = 4, trash = 0) {
    await page.goto('/');
    await expect(page.locator('.gallery-strip')).toBeVisible();
    await page.evaluate(async ({ active, trash }) => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 240;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#24c4a3'; context.fillRect(0, 0, 320, 240);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/jpeg'));
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('timestamp-photos');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const tx = database.transaction(['photos', 'trash', 'metadata'], 'readwrite');
        tx.objectStore('photos').clear(); tx.objectStore('trash').clear(); tx.objectStore('metadata').clear();
        for (let index = 0; index < active + trash; index++) {
            const record = {
                id: `photo-${index}`, baseBlob: blob, width: 320, height: 240,
                createdAtISO: new Date(Date.now() + index).toISOString(), timeMode: 'custom',
                timeValueISO: '2026-10-15T03:15:59.000Z', sourceName: `fixture-${index}`,
                fromFrontMirror: false, remark: '',
            };
            if (index < active) tx.objectStore('photos').put(record);
            else tx.objectStore('trash').put({ ...record, deletedAtISO: new Date(Date.now() - 45 * 86400000).toISOString() });
        }
        await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
        database.close();
    }, { active, trash });
    await page.reload();
    await expect(page.locator('.thumbnail')).toHaveCount(active);
}

async function savedOrder(page: Page) {
    return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('timestamp-photos');
        open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction('metadata').objectStore('metadata').get('photo-order');
            request.onsuccess = () => { resolve(request.result?.ids ?? []); db.close(); };
            request.onerror = () => reject(request.error);
        };
    }));
}

test('active originals open before trash; progress, reminder and manual restore preserve old images', async ({ page }) => {
    await seed(page, 4, 250);
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ถังขยะ',{exact:true}).click();
    await expect(page.locator('.trash-load-status progress')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ล้างถังขยะ', exact: true })).toBeDisabled();
    await expect(page.locator('.trash-item')).toHaveCount(250);
    await expect(page.locator('.trash-load-status')).toHaveCount(0);
    await page.getByTitle('ปิด', { exact: true }).click();
    await expect(page.getByText('มีรูปในถังขยะเกิน 30 วัน', { exact: true })).toBeVisible();
    await expect(page.getByText('พบ 250 รูป', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'เปิดถังขยะ', exact: true }).click();
    await expect(page.locator('.trash-item')).toHaveCount(250);
    await page.locator('.trash-item input').first().check();
    await page.getByRole('button', { name: 'กู้คืน', exact: true }).click();
    await expect(page.locator('.trash-item')).toHaveCount(249);
    await page.getByTitle('ปิด', { exact: true }).click();
    await expect(page.locator('.thumbnail')).toHaveCount(5);
    await page.locator('.thumbnail').last().click();
    await expect(page.getByRole('heading', { name: 'รูปที่ 5 / 5', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.thumbnail')).toHaveCount(5);
    await expect(page.getByText('มีรูปในถังขยะเกิน 30 วัน', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'เปิดถังขยะ', exact: true }).click();
    await expect(page.locator('.trash-item')).toHaveCount(249);
    await page.screenshot({ path: `test-results/trash-${test.info().project.name}.png` });
});

test('pointer and keyboard sorting persist; previews reflect the saved order', async ({ page }) => {
    await seed(page);
    await expect(page.getByRole('button', { name: 'จัดเรียง', exact: true })).toHaveCount(0);
    const first = page.locator('.thumbnail').nth(0);
    const third = page.locator('.thumbnail').nth(2);
    const start = (await first.boundingBox())!;
    const end = (await third.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await expect(page.locator('.drag-overlay')).toBeVisible();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect.poll(() => savedOrder(page)).toEqual(['photo-1', 'photo-2', 'photo-0', 'photo-3']);
    await expect(page.locator('.gallery-strip')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.drag-overlay')).toHaveCount(0);
    const keyboardStart = (await page.locator('.thumbnail').first().boundingBox())!;
    await page.locator('.thumbnail').first().focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.drag-overlay')).toBeVisible();
    await page.locator('.drag-overlay').evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await page.locator('.drag-overlay').boundingBox())!.x).toBeGreaterThan(keyboardStart.x + 20);
    await page.keyboard.press('Space');
    await expect.poll(() => savedOrder(page)).toEqual(['photo-2', 'photo-1', 'photo-0', 'photo-3']);
    await expect(page.getByRole('button', { name: 'ยกเลิก', exact: true })).toHaveCount(0);
    await page.waitForTimeout(300); // The drop-release click must not open a preview.
    await page.locator('.thumbnail').first().click();
    await expect(page.getByRole('heading', { name: 'รูปที่ 1 / 4', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.thumbnail')).toHaveCount(4);
    expect(await savedOrder(page)).toEqual(['photo-2', 'photo-1', 'photo-0', 'photo-3']);
    await page.screenshot({ path: `test-results/sorting-${test.info().project.name}.png` });
});

test('long press groups from the leftmost selected card and supports partial and full split', async ({ page }) => {
    await seed(page, 5);
    const main = page.locator('.gallery-strip[aria-busy]');
    const memberRow = page.locator('.group-members[aria-label="รูปในกลุ่ม"]');
    const cancel = page.getByRole('button', { name: 'ยกเลิก', exact: true });
    const group = (count: number) => main.getByRole('button', { name: `เปิดกลุ่ม ${count} รูป`, exact: true });
    async function hold(card: ReturnType<Page['locator']>) {
        await card.scrollIntoViewIfNeeded();
        const box = (await card.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await expect(page.locator('.drag-overlay')).toBeVisible();
        await page.mouse.up();
        await expect(cancel).toBeVisible();
    }

    await expect(cancel).toHaveCount(0);
    await hold(main.locator('.thumbnail').nth(1));
    // The long-press release is suppressed, so taps start after the drop guard.
    await expect(page.locator('.drag-overlay')).toHaveCount(0);
    await page.waitForTimeout(260);
    await expect(main.locator('.thumbnail').nth(1)).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('button', { name: /จับกลุ่ม/ })).toBeDisabled();
    await main.locator('.thumbnail').nth(4).click();
    await main.locator('.thumbnail').nth(3).click();
    await page.getByRole('button', { name: 'จับกลุ่ม 3 รูป' }).click();
    await expect(main.locator('.thumbnail').nth(1)).toHaveAccessibleName('เปิดกลุ่ม 3 รูป');
    await page.reload();
    await group(3).click();
    await expect(memberRow.locator('.thumbnail')).toHaveCount(3);
    await hold(memberRow.locator('.thumbnail').first());
    await expect(page.getByRole('button', { name: 'แยกออกจากกลุ่ม' })).toBeEnabled();
    await page.waitForTimeout(260);
    await page.getByRole('button', { name: 'แยกออกจากกลุ่ม' }).click();
    await expect(main.getByRole('button', {name:'ปิดกลุ่ม 2 รูป',exact:true})).toBeVisible();
    await expect(memberRow.locator('.thumbnail')).toHaveCount(2);
    await hold(memberRow.locator('.thumbnail').last());
    await page.waitForTimeout(260);
    await page.getByRole('button', { name: 'เพิ่มเติม', exact: true }).click();
    await page.getByRole('button', { name: 'สลายกลุ่ม' }).click();
    await expect(main.locator('.thumbnail')).toHaveCount(5);
    await expect(memberRow).toHaveCount(0);
});

test('group members drag independently and selected download and trash work in both rows', async ({ page }) => {
    await seed(page, 5);
    await page.evaluate(() => localStorage.setItem('timestamp-photo-groups', JSON.stringify([['photo-0', 'photo-2', 'photo-3']])));
    await page.reload();
    const main = page.locator('.gallery-strip[aria-busy]');
    const members = page.locator('.group-members[aria-label="รูปในกลุ่ม"]');
    const download = page.getByRole('button', { name: 'ดาวน์โหลดที่เลือก' });
    const remove = page.getByRole('button', { name: 'ลบที่เลือก' });
    const cancel = page.getByRole('button', { name: 'ยกเลิก', exact: true });
    const group = main.getByRole('button', { name: 'เปิดกลุ่ม 3 รูป' });
    async function drag(row: ReturnType<Page['locator']>, from: number, to: number) {
        const cards = row.locator('.thumbnail');
        await cards.nth(from).scrollIntoViewIfNeeded();
        await cards.nth(to).scrollIntoViewIfNeeded();
        await row.evaluate(async el => { await Promise.all(el.getAnimations({subtree:true}).map(a => a.finished.catch(() => {}))); });
        const start = (await cards.nth(from).boundingBox())!;
        const end = (await cards.nth(to).boundingBox())!;
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
        await page.mouse.down();
        await expect(page.locator('.drag-overlay')).toHaveCount(1);
        if (from !== to) await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(260);
    }
    async function downloadAndRemove() {
        await expect(download).toBeVisible();
        const file = page.waitForEvent('download', { timeout: 5000 });
        await download.click();
        expect((await file).suggestedFilename()).toMatch(/\.jpg$/);
        await page.getByRole('button', { name: 'เพิ่มเติม', exact: true }).click();
        await remove.click();
        await page.getByRole('alertdialog').getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    }
    await group.click();
    await drag(members, 0, 2);
    await expect.poll(() => savedOrder(page)).toEqual(['photo-2', 'photo-1', 'photo-3', 'photo-0', 'photo-4']);
    await expect(cancel).toHaveCount(0);
    await page.getByRole('button', { name: 'จัดการ', exact: true }).click();
    await expect(download).toBeDisabled();
    await members.locator('.thumbnail').first().click();
    await downloadAndRemove();
    await expect(members.locator('.thumbnail')).toHaveCount(2);
    await expect(cancel).toHaveCount(0);
    await page.getByRole('button',{name:'ปิดกลุ่ม 2 รูป',exact:true}).click();
    await drag(main, 0, 0);
    await expect(main.locator('.thumbnail').first()).toHaveAttribute('aria-pressed', 'true');
    await downloadAndRemove();
    await expect(main.locator('.thumbnail')).toHaveCount(2);
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ถังขยะ',{exact:true}).click();
    await expect(page.locator('.trash-item')).toHaveCount(2);
});

test('deleting a card during background trash loading does not lose or duplicate it', async ({ page }) => {
    await seed(page, 4, 300);
    await page.locator('.thumbnail').first().click();
    await page.getByRole('button', { name: 'ลบรูปนี้', exact: false }).click();
    await page.getByRole('alertdialog').getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(page.locator('.thumbnail')).toHaveCount(3);
    await page.getByRole('button',{name:'ปิดตัวอย่างภาพ'}).click();
    await expect(page.locator('.preview-modal')).toHaveCount(0);
    await page.getByRole('button', { name: 'เปิดถังขยะ', exact: true }).click();
    await expect(page.locator('.trash-item')).toHaveCount(301);
    await expect(page.locator('.trash-load-status')).toHaveCount(0);
    await expect(page.locator('.trash-item strong', { hasText: /^fixture-0$/ })).toHaveCount(1);
});

test('touch drag reorders cards on mobile', async ({ page, context, isMobile }) => {
    test.skip(!isMobile, 'Touch gesture is covered by the mobile project');
    await seed(page);
    const start = (await page.locator('.thumbnail').nth(0).boundingBox())!;
    const end = (await page.locator('.thumbnail').nth(2).boundingBox())!;
    const session = await context.newCDPSession(page);
    const y = start.y + start.height / 2;
    const x = start.x + start.width / 2;
    const targetX = end.x + end.width / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await expect(page.locator('.drag-overlay')).toBeVisible();
    for (let step = 1; step <= 12; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (targetX - x) * step / 12, y }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => savedOrder(page)).toEqual(['photo-1', 'photo-2', 'photo-0', 'photo-3']);
    await session.detach();
});

test('dragging near the edge scrolls the gallery and preserves every card', async ({ page }) => {
    await seed(page, 30);
    await page.locator('.gallery-strip').evaluate((element) => { element.scrollTo({ left: 0, behavior: 'instant' }); });
    await expect.poll(() => page.locator('.gallery-strip').evaluate((element) => element.scrollLeft)).toBeLessThan(128);
    // Start from a fully visible card, including mobile's scroll anchoring offset.
    const first = (await page.locator('.thumbnail').nth(2).boundingBox())!;
    const strip = (await page.locator('.gallery-strip').boundingBox())!;
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await expect(page.locator('.drag-overlay')).toBeVisible();
    await page.mouse.move(strip.x + strip.width - 8, first.y + first.height / 2, { steps: 30 });
    await expect.poll(() => page.locator('.gallery-strip').evaluate((element) => element.scrollLeft)).toBeGreaterThan(150);
    await page.mouse.move(strip.x + strip.width / 2, first.y + first.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await savedOrder(page)).length).toBe(30);
    expect(new Set(await savedOrder(page)).size).toBe(30);
    await expect(page.locator('.thumbnail')).toHaveCount(30);
});

test('tap opens preview; hold takes 400ms and lifted card stays in one row', async ({ page }) => {
    await seed(page);
    await page.locator('.thumbnail').first().click();
    await expect(page.getByRole('heading', { name: 'รูปที่ 1 / 4', exact: true })).toBeVisible();
    await page.locator('.preview-modal .modal-header button').click();
    await expect(page.locator('.preview-modal')).toHaveCount(0);
    const card = (await page.locator('.thumbnail').first().boundingBox())!;
    const stripHeight = await page.locator('.gallery-strip').evaluate((element) => element.clientHeight);
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await expect(page.locator('.drag-overlay')).toHaveCount(0);
    await expect(page.locator('.drag-overlay')).toBeVisible();
    await page.mouse.move(card.x + card.width * 2, card.y + 140, { steps: 12 });
    await expect.poll(async () => Math.abs((await page.locator('.drag-overlay').boundingBox())!.y - card.y)).toBeLessThan(12);
    expect(await page.locator('.gallery-strip').evaluate((element) => element.clientHeight)).toBe(stripHeight);
    await page.screenshot({ path: `test-results/long-press-${test.info().project.name}.png` });
    await page.mouse.up();
    await expect(page.locator('.drag-overlay')).toHaveCount(0);
    await expect(page.locator('.preview-modal')).toHaveCount(0);
});

test('a quick touch swipe scrolls without reordering or opening preview', async ({ page, context, isMobile }) => {
    test.skip(!isMobile, 'Native touch scrolling is covered by the mobile project');
    await seed(page, 30);
    const strip = page.locator('.gallery-strip');
    await strip.evaluate((element) => element.scrollTo({ left: 0, behavior: 'instant' }));
    await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeLessThan(128);
    const card = (await page.locator('.thumbnail').nth(3).boundingBox())!;
    const x = card.x + card.width / 2;
    const y = card.y + card.height / 2;
    const session = await context.newCDPSession(page);
    const before = await strip.evaluate((element) => element.scrollLeft);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 25, y }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before + 30);
    await expect(page.locator('.drag-overlay')).toHaveCount(0);
    await expect(page.locator('.preview-modal')).toHaveCount(0);
    expect(await savedOrder(page)).toEqual([]);
    await session.detach();
});

test('gallery shoulder controls reach both ends and selection is explicit', async ({ page }) => {
    await seed(page, 30);
    const rail = page.locator('.gallery-strip[aria-busy]');
    await page.getByRole('button', {name:'เลื่อนไปขวาสุด',exact:true}).click();
    await expect.poll(() => rail.evaluate(el => Math.abs(el.scrollWidth-el.clientWidth-el.scrollLeft))).toBeLessThan(3);
    await page.getByRole('button', {name:'เลื่อนไปซ้ายสุด',exact:true}).click();
    await expect.poll(() => rail.evaluate(el => el.scrollLeft)).toBeLessThan(3);
    await page.getByRole('button', {name:'เลือก',exact:true}).click();
    await rail.locator('.thumbnail').nth(0).click();
    await rail.locator('.thumbnail').nth(1).click();
    await page.getByRole('button',{name:'จับกลุ่ม 2 รูป',exact:true}).click();
    await expect(rail.locator('.group-thumbnail')).toHaveCount(1);
    await rail.locator('.group-thumbnail').click();
    await expect(page.locator('.group-members[aria-label="รูปในกลุ่ม"] .thumbnail')).toHaveCount(2);
    await page.getByRole('button',{name:'ปิดกลุ่ม 2 รูป',exact:true}).click();
    await expect(page.locator('.group-members[aria-label="รูปในกลุ่ม"]')).toHaveCount(0);
});

test('preview swipes follow gallery order and stay inside a group', async ({ page }) => {
    await seed(page, 5);
    await page.evaluate(() => localStorage.setItem('timestamp-photo-groups', JSON.stringify([['photo-1','photo-3']])));
    await page.reload();
    const main = page.locator('.gallery-strip[aria-busy]');
    await main.locator('.thumbnail').first().click();
    const frame = page.locator('.preview-canvas-container');
    await expect(frame).toBeVisible();
    await page.locator('.preview-sheet').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
    const swipe = async (direction: number) => {
        await page.locator('.preview-sheet').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
        const b = (await frame.boundingBox())!;
        await page.mouse.move(b.x + b.width/2 + direction * 65, b.y + b.height/2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width/2 - direction * 65, b.y + b.height/2, {steps:12});
        await page.mouse.up();
    };
    await swipe(1);
    await expect(page.getByRole('heading',{name:'รูปที่ 2 / 5',exact:true})).toBeVisible();
    await swipe(-1);
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 5',exact:true})).toBeVisible();
    await swipe(-1);
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 5',exact:true})).toBeVisible();
    await page.locator('.preview-modal .modal-header button').click();
    await main.locator('.group-thumbnail').click();
    await page.locator('.group-members[aria-label="รูปในกลุ่ม"] .thumbnail').first().click();
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 2',exact:true})).toBeVisible();
    await swipe(1);
    await expect(page.getByRole('heading',{name:'รูปที่ 2 / 2',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'รูปถัดไป',exact:true})).toBeDisabled();
});

test('selection toolbar is stable and whole groups combine with singles', async ({page}) => {
    await seed(page, 5);
    await page.evaluate(() => localStorage.setItem('timestamp-photo-groups', JSON.stringify([['photo-1','photo-3']])));
    await page.reload();
    const main = page.locator('.gallery-strip[aria-busy]');
    await page.getByRole('button',{name:'เลือก',exact:true}).click();
    const download = page.getByRole('button',{name:'ดาวน์โหลดที่เลือก',exact:true});
    await expect(download).toBeDisabled();
    const before = await download.boundingBox();
    await main.locator('.group-thumbnail').click();
    await expect(download).toBeEnabled();
    await expect(page.getByRole('button',{name:'จับกลุ่ม',exact:true})).toBeDisabled();
    await main.locator('.thumbnail').first().click();
    await expect(page.getByRole('button',{name:'จับกลุ่ม 3 รูป',exact:true})).toBeEnabled();
    expect((await download.boundingBox())?.x).toBe(before?.x);
    await page.getByRole('button',{name:'จับกลุ่ม 3 รูป',exact:true}).click();
    await expect(main.getByRole('button',{name:'เปิดกลุ่ม 3 รูป',exact:true})).toBeVisible();
    await page.reload();
    await expect(main.getByRole('button',{name:'เปิดกลุ่ม 3 รูป',exact:true})).toBeVisible();
});

test('preview follows finger and springs back on short or edge swipes', async ({page}) => {
    await seed(page, 4);
    await page.locator('.thumbnail').nth(1).click();
    const frame = page.locator('.preview-canvas-container');
    const track = page.locator('.preview-track');
    await expect(page.locator('.active-preview-canvas')).toBeVisible();
    await page.locator('.preview-sheet').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
    const x = () => track.evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
    const b = (await frame.boundingBox())!;
    const midX = b.x + b.width/2, midY = b.y + b.height/2;
    await page.mouse.move(midX,midY);
    await page.mouse.down();
    await page.mouse.move(midX-20,midY,{steps:4});
    await expect.poll(x).toBeLessThan(-15);
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(x).toBeCloseTo(0,0);
    await expect(page.getByRole('heading',{name:'รูปที่ 2 / 4',exact:true})).toBeVisible();
    await page.mouse.move(midX+75,midY);
    await page.mouse.down();
    await page.mouse.move(midX-75,midY,{steps:12});
    await expect.poll(x).toBeLessThan(-120);
    await page.mouse.up();
    await expect(page.getByRole('heading',{name:'รูปที่ 3 / 4',exact:true})).toBeVisible();
    await expect.poll(x).toBeCloseTo(0,0);
    await expect(page.locator('.preview-slide')).toHaveCount(3);
    await page.getByRole('button',{name:'รูปถัดไป',exact:true}).click();
    await expect(page.getByRole('heading',{name:'รูปที่ 4 / 4',exact:true})).toBeVisible();
    await page.mouse.move(midX+75,midY);
    await page.mouse.down();
    await page.mouse.move(midX-75,midY,{steps:10});
    const edge = await x();
    expect(edge).toBeLessThan(0); expect(edge).toBeGreaterThanOrEqual(-38.1);
    await page.mouse.up();
    await expect.poll(x).toBeCloseTo(0,0);
    await expect(page.getByRole('heading',{name:'รูปที่ 4 / 4',exact:true})).toBeVisible();
    await expect(page.locator('.preview-slide')).toHaveCount(2);
});

test('preview reduced motion keeps navigation and avoids duplicate animation', async ({page}) => {
    await page.emulateMedia({reducedMotion:'reduce'});
    await seed(page, 3);
    await page.locator('.thumbnail').first().click();
    await expect(page.locator('.active-preview-canvas')).toBeVisible();
    await page.getByRole('button',{name:'รูปถัดไป',exact:true}).click();
    await expect(page.getByRole('heading',{name:'รูปที่ 2 / 3',exact:true})).toBeVisible();
    expect(await page.locator('.preview-track').evaluate(el => el.getAnimations().length)).toBe(0);
});

test('stable group identity survives member reorder and undo restores previous membership', async ({page}) => {
    await seed(page, 5);
    await page.evaluate(() => localStorage.setItem('timestamp-photo-groups', JSON.stringify([['photo-0','photo-2','photo-3']])));
    await page.reload();
    const main = page.locator('.gallery-strip[aria-busy]');
    const group = main.locator('.group-thumbnail');
    const id = await group.getAttribute('data-card-id');
    expect(id).toMatch(/^group:/);
    await group.click();
    const members = page.locator('.group-members[aria-label="รูปในกลุ่ม"]');
    const first = members.locator('.thumbnail').first();
    const last = members.locator('.thumbnail').last();
    await first.scrollIntoViewIfNeeded();
    await last.scrollIntoViewIfNeeded();
    await members.evaluate(async el => { await Promise.all(el.getAnimations({subtree:true}).map(a => a.finished.catch(() => {}))); });
    const a = (await first.boundingBox())!, b = (await last.boundingBox())!;
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
    await page.mouse.down();
    await expect(page.locator('.drag-overlay')).toBeVisible();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});
    await page.mouse.up();
    await expect.poll(() => savedOrder(page)).toEqual(['photo-2','photo-1','photo-3','photo-0','photo-4']);
    await expect(group).toHaveAttribute('data-card-id',id!);
    await expect(members.locator('.thumbnail')).toHaveCount(3);
    await expect(page.getByRole('button',{name:'ยกเลิก',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'จัดการ',exact:true}).click();
    await members.locator('.thumbnail').first().click();
    await expect(members.locator('.thumbnail').first()).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'แยกออกจากกลุ่ม',exact:true}).click();
    await expect(members.locator('.thumbnail')).toHaveCount(2);
    await page.getByRole('button',{name:'ย้อนกลับ',exact:true}).click();
    await expect(members.locator('.thumbnail')).toHaveCount(3);
    await expect(group).toHaveAttribute('data-card-id',id!);
    await page.reload();
    await expect(group).toHaveAttribute('data-card-id',id!);
});

test('group expands inline toward the right, keeps the rail height and scrolls as one row', async ({page}) => {
    await seed(page, 6);
    await page.evaluate(() => localStorage.setItem('timestamp-photo-groups', JSON.stringify([['photo-1','photo-3','photo-4']])));
    await page.reload();
    const rail = page.locator('.gallery-strip[aria-busy]');
    const group = rail.locator('.group-thumbnail');
    const id = await group.getAttribute('data-card-id');
    const height = await rail.evaluate(el => el.clientHeight);
    const before = (await group.boundingBox())!;
    await group.click();
    const inline = rail.locator('.inline-group');
    await expect(inline.locator('.group-members .thumbnail')).toHaveCount(3);
    await expect(page.locator('.gallery-strip')).toHaveCount(1);
    await expect(group).toHaveAttribute('aria-expanded','true');
    expect(await rail.evaluate(el => el.clientHeight)).toBe(height);
    await expect.poll(async () => {
        const anchor = (await group.boundingBox())!, member = (await inline.locator('.group-members .thumbnail').first().boundingBox())!;
        return member.x >= anchor.x + anchor.width && Math.abs(member.y - anchor.y) < 2;
    }).toBe(true);
    expect((await group.boundingBox())!.y).toBeCloseTo(before.y,0);
    await page.getByRole('button',{name:'เลื่อนไปขวาสุด',exact:true}).click();
    await expect.poll(() => rail.evaluate(el => Math.abs(el.scrollWidth-el.clientWidth-el.scrollLeft))).toBeLessThan(3);
    await group.click();
    await expect(inline).toHaveCount(0);
    await expect(group).toHaveAttribute('data-card-id',id!);
    await expect(group).toHaveAttribute('aria-expanded','false');
});

test('tapping an outside photo collapses an expanded group and opens the intended photo', async ({page}) => {
    await seed(page, 7);
    await page.evaluate(() => localStorage.setItem('timestamp-photo-groups', JSON.stringify([['photo-1','photo-2'],['photo-4','photo-5']])));
    await page.reload();
    const main = page.locator('.gallery-strip[aria-busy]');
    const groups = main.locator('.group-thumbnail');
    const inline = main.locator('.inline-group');
    await groups.first().click();
    await expect(inline).toHaveCount(1);
    // Member preview remains scoped to its group and does not collapse it.
    await inline.locator('.group-members .thumbnail').first().click();
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 2',exact:true})).toBeVisible();
    await page.locator('.preview-modal .modal-header button').click();
    await expect(inline).toHaveCount(1);
    // Opening a different group closes the previous one.
    await groups.last().click();
    await expect(inline).toHaveCount(1);
    await expect(inline.locator('[data-card-id="photo-4"]')).toBeVisible();
    // A standalone photo closes the open group and opens immediately.
    await main.locator('[data-card-id="photo-6"]').click();
    await expect(inline).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'รูปที่ 7 / 7',exact:true})).toBeVisible();
    await page.locator('.preview-modal .modal-header button').click();
    await expect(inline).toHaveCount(0);
    await groups.first().click();
    await page.getByRole('button',{name:'จัดการ',exact:true}).click();
    await inline.locator('.group-members .thumbnail').first().click();
    await main.locator('[data-card-id="photo-0"]').click();
    await expect(inline).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 7',exact:true})).toBeVisible();
    await page.locator('.preview-modal .modal-header button').click();
    await expect(page.getByRole('button',{name:'ยกเลิก',exact:true})).toHaveCount(0);
});

test('preview double tap zooms, pans within bounds and swipe down closes only at fitted zoom', async ({page}) => {
    await seed(page,4);
    await page.locator('.thumbnail').nth(1).click();
    const frame=page.locator('.preview-canvas-container'), canvas=page.locator('.active-preview-canvas');
    await expect(canvas).toBeVisible();
    await page.locator('.preview-sheet').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
    const b=(await frame.boundingBox())!, x=b.x+b.width/2,y=b.y+b.height/2;
    const transform=()=>canvas.evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return {z:m.a,x:m.m41,y:m.m42};});
    await page.mouse.dblclick(x+20,y-15);
    await expect.poll(async()=> (await transform()).z).toBeCloseTo(2.5,1);
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+120,y+100,{steps:8});await page.mouse.up();
    await expect(page.locator('.preview-modal')).toBeVisible();
    await page.waitForTimeout(260);
    const bounded=await canvas.evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform), v=el.closest('.preview-canvas-container')!;return Math.abs(m.m41)<=Math.max(0,(el.clientWidth*m.a-v.clientWidth)/2)+1 && Math.abs(m.m42)<=Math.max(0,(el.clientHeight*m.a-v.clientHeight)/2)+1;});
    expect(bounded).toBe(true);
    await page.mouse.dblclick(x,y);
    await expect.poll(async()=> (await transform()).z).toBeCloseTo(1,2);
    await page.mouse.move(x,y-45);await page.mouse.down();await page.mouse.move(x,y-20,{steps:4});await page.mouse.up();
    await expect(page.locator('.preview-modal')).toBeVisible();
    await expect.poll(()=>page.locator('.preview-modal .modal-content').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBeCloseTo(0,0);
    await page.mouse.move(x,y-55);await page.mouse.down();await page.mouse.move(x,y+65,{steps:10});await page.mouse.up();
    await expect(page.locator('.preview-modal')).toHaveCount(0);
});
test('closing preview reveals the last viewed card in gallery',async({page})=>{
    await seed(page,18);
    const rail=page.locator('.gallery-strip[aria-busy]');
    await page.getByRole('button',{name:'เลื่อนไปซ้ายสุด',exact:true}).click();
    await expect.poll(()=>rail.evaluate(el=>el.scrollLeft)).toBeLessThan(3);
    await rail.locator('.thumbnail').first().click();
    for(let i=0;i<10;i++) {
        await page.getByRole('button',{name:'รูปถัดไป',exact:true}).click();
        await expect(page.getByRole('heading',{name:`รูปที่ ${i+2} / 18`,exact:true})).toBeVisible();
    }
    await page.getByRole('button',{name:'ปิดตัวอย่างภาพ'}).click();
    await expect(page.locator('.preview-modal')).toHaveCount(0);
    const card=rail.locator('[data-card-id="photo-10"]');
    await expect.poll(async()=>{const a=(await card.boundingBox())!,b=(await rail.boundingBox())!;return a.x>=b.x-1&&a.x+a.width<=b.x+b.width+1;}).toBe(true);
});

test('batch edit patches only selected fields and persists without replacing originals', async ({page}) => {
    await seed(page,5);
    await page.evaluate(async () => {
        const {db}=await import('/src/lib/legacyDb.ts');
        await db.photos.update('photo-0',{remark:'original A',timeValueISO:'2026-10-10T01:00:00.000Z',locationLatitude:13.1,locationLongitude:100.2,locationAddress:'A'});
        await db.photos.update('photo-2',{remark:'original C',timeValueISO:'2026-10-12T03:00:00.000Z',locationLatitude:13.3,locationLongitude:100.4,locationAddress:'C'});
    });
    await page.reload();
    const rail=page.locator('.gallery-strip');
    await page.getByRole('button',{name:'เลือก',exact:true}).click();
    const edit=page.getByRole('button',{name:'แก้ไขที่เลือก',exact:true});
    await expect(edit).toBeDisabled();
    await rail.locator('[data-card-id="photo-0"]').click();
    await rail.locator('[data-card-id="photo-2"]').click();
    await edit.click();
    const modal=page.getByRole('dialog',{name:'แก้ไขหลายภาพ',exact:true});
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button',{name:'ตรวจสอบการแก้ไข'})).toBeDisabled();
    await modal.locator('#batch-time').selectOption('copy');
    await modal.getByLabel('ภาพต้นแบบ',{exact:true}).selectOption('photo-2');
    await modal.locator('#batch-remark').selectOption('replace');
    await modal.getByLabel('Remark ใหม่').fill('batch remark');
    await modal.getByRole('button',{name:'ตรวจสอบการแก้ไข'}).click();
    await expect(modal.getByText('ยืนยันแก้ไข 2 รูป?',{exact:true})).toBeVisible();
    await modal.getByRole('button',{name:'ยืนยันบันทึก'}).click();
    await expect(modal).toHaveCount(0);
    await expect(rail.locator('[aria-pressed="true"]')).toHaveCount(2);
    await page.reload();
    await expect(rail.locator('.thumbnail')).toHaveCount(5);
    const result=await page.evaluate(async()=>{
        const {db}=await import('/src/lib/legacyDb.ts');
        return Promise.all(['photo-0','photo-1','photo-2'].map(async id=>{
            const p=(await db.photos.get(id))!;
            return {time:p.timeValueISO,remark:p.remark,lat:p.locationLatitude,address:p.locationAddress,size:p.baseBlob.size};
        }));
    });
    expect(result[0]).toMatchObject({time:'2026-10-12T03:00:00.000Z',remark:'batch remark',lat:13.1,address:'A'});
    expect(result[2]).toMatchObject({time:'2026-10-12T03:00:00.000Z',remark:'batch remark',lat:13.3,address:'C'});
    expect(result[1]).toMatchObject({time:'2026-10-15T03:15:59.000Z',remark:''});
    expect(result[0].size).toBe(result[1].size);
});
test('batch edit inside group scopes to selected members; cancel leaves data unchanged',async({page})=>{
    await seed(page,5);
    await page.evaluate(()=>localStorage.setItem('timestamp-photo-groups',JSON.stringify([['photo-0','photo-2','photo-4']])));
    await page.reload();
    await page.locator('.group-thumbnail').click();
    await page.getByRole('button',{name:'จัดการ',exact:true}).click();
    await page.locator('.group-members [data-card-id="photo-2"]').click();
    const edit=page.getByRole('button',{name:'แก้ไขที่เลือก',exact:true});
    await edit.click();
    const modal=page.getByRole('dialog',{name:'แก้ไขหลายภาพ',exact:true});
    await modal.locator('#batch-remark').selectOption('replace');
    await modal.getByLabel('Remark ใหม่').fill('not saved');
    await modal.getByRole('button',{name:'ยกเลิก',exact:true}).click();
    await expect(modal).toHaveCount(0);
    await edit.click();
    await modal.locator('#batch-time').selectOption('now');
    await modal.locator('#batch-remark').selectOption('replace');
    await modal.getByLabel('Remark ใหม่').fill('member only');
    await modal.getByRole('button',{name:'ตรวจสอบการแก้ไข'}).click();
    await modal.getByRole('button',{name:'ยืนยันบันทึก'}).click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator('.group-members .thumbnail')).toHaveCount(3);
    const records=await page.evaluate(async()=>{const {db}=await import('/src/lib/legacyDb.ts');return (await db.photos.toArray()).map(p=>({id:p.id,remark:p.remark,mode:p.timeMode}));});
    expect(records.filter(p=>p.remark==='member only').map(p=>p.id)).toEqual(['photo-2']);
    expect(records.filter(p=>p.mode==='now').map(p=>p.id)).toEqual(['photo-2']);
});
test('batch storage transaction rolls back if one selected photo is missing',async({page})=>{
    await seed(page,3);
    const result=await page.evaluate(async()=>{
        const {updatePhotos}=await import('/src/lib/db.ts');
        const {db}=await import('/src/lib/legacyDb.ts');
        let rejected=false;
        try {await updatePhotos(['photo-0','missing'],{remark:'should rollback'});} catch {rejected=true;}
        return {rejected,remark:(await db.photos.get('photo-0'))?.remark};
    });
    expect(result).toEqual({rejected:true,remark:''});
});

test('deleting in preview prefers previous then next and closes only at the last image',async({page})=>{
    await seed(page,4);
    await page.locator('[data-card-id="photo-2"]').click();
    const remove=page.getByRole('button',{name:'ลบรูปนี้'});
    await remove.click();
    await page.getByRole('alertdialog').getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(page.getByRole('heading',{name:'รูปที่ 2 / 3',exact:true})).toBeVisible();
    await remove.click();
    await page.getByRole('alertdialog').getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 2',exact:true})).toBeVisible();
    await remove.click();
    await page.getByRole('alertdialog').getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 1',exact:true})).toBeVisible();
    await remove.click();
    await page.getByRole('alertdialog').getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(page.locator('.preview-modal')).toHaveCount(0);
    await expect(page.locator('.thumbnail')).toHaveCount(0);
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ถังขยะ',{exact:true}).click();
    await expect(page.locator('.trash-item')).toHaveCount(4);
});
test('auto trash toggle persists; only confirmed exports move to trash including partial success',async({page})=>{
    await seed(page,4);
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ตั้งค่า',{exact:true}).click();
    await page.locator('.settings-category').filter({hasText:'ดาวน์โหลด'}).click();
    const toggle=page.getByRole('switch',{name:'ลบภาพอัตโนมัติหลังดาวน์โหลด'});
    await expect(toggle).toHaveAttribute('aria-checked','false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked','true');
    await page.reload();
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ตั้งค่า',{exact:true}).click();
    await page.locator('.settings-category').filter({hasText:'ดาวน์โหลด'}).click();
    await expect(toggle).toHaveAttribute('aria-checked','true');
    await page.reload();
    await page.evaluate(()=>{
        let writes=0;
        Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>({
            getFileHandle:async()=>({createWritable:async()=>({write:async()=>{if(++writes===2)throw new Error('disk full');},close:async()=>{}})})
        })});
    });
    await page.getByTitle('ดาวน์โหลดทั้งหมด',{exact:true}).click();
    await expect(page.locator('.thumbnail')).toHaveCount(3);
    await expect(page.locator('[data-card-id="photo-0"]')).toHaveCount(0);
    await expect(page.locator('[data-card-id="photo-1"]')).toHaveCount(1);
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ถังขยะ',{exact:true}).click();
    await expect(page.locator('.trash-item')).toHaveCount(1);
});
test('browser download without disk confirmation keeps original even when auto trash enabled',async({page})=>{
    await seed(page,2);
    await page.evaluate(()=>{const settings=JSON.parse(localStorage.getItem('timestamp-settings')??'{}');localStorage.setItem('timestamp-settings',JSON.stringify({...settings,autoTrashAfterDownload:true}));});
    await page.reload();
    await page.locator('.thumbnail').first().click();
    const file=page.waitForEvent('download');
    await page.locator('.preview-actions .btn-primary').click();
    await file;
    await expect(page.locator('.preview-modal')).toBeVisible();
    await expect(page.locator('.thumbnail')).toHaveCount(2);
});

test('back closes picker then preview and group selection in order',async({page})=>{
    await seed(page,5);
    await page.evaluate(()=>localStorage.setItem('timestamp-photo-groups',JSON.stringify([['photo-0','photo-1','photo-2']])));
    await page.reload();
    const back=()=>page.evaluate(()=>window.dispatchEvent(new Event('native-app-back')));
    await page.locator('.group-thumbnail').click();
    await page.locator('.group-members .thumbnail').first().click();
    await page.locator('.preview-modal .date-time-wheel-trigger').click();
    await expect(page.getByRole('dialog',{name:'ตั้งวันที่และเวลา'})).toBeVisible();
    await back();
    await expect(page.locator('.datetime-picker-backdrop')).toHaveCount(0);
    await expect(page.locator('.preview-modal')).toBeVisible();
    await back();
    await expect(page.locator('.preview-modal')).toHaveCount(0);
    await expect(page.locator('.inline-group')).toHaveCount(1);
    await page.getByRole('button',{name:'จัดการ',exact:true}).click();
    await page.getByRole('button',{name:'เพิ่มเติม',exact:true}).click();
    await back();
    await expect(page.locator('.selection-menu')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'ยกเลิก',exact:true})).toBeVisible();
    await back();
    await expect(page.getByRole('button',{name:'ยกเลิก',exact:true})).toHaveCount(0);
    await expect(page.locator('.inline-group')).toHaveCount(1);
    await back();
    await expect(page.locator('.inline-group')).toHaveCount(0);
    expect(await page.evaluate(()=>(window as any).timestampHandleBack())).toBe(false);
});
test('confirmation back cancels deletion and permanent deletion explicitly confirms',async({page})=>{
    await seed(page,3);
    const back=()=>page.evaluate(()=>window.dispatchEvent(new Event('native-app-back')));
    await page.getByTitle('ลบทั้งหมด',{exact:true}).click();
    const dialog=page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await back();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.thumbnail')).toHaveCount(3);
    await page.getByTitle('ลบทั้งหมด',{exact:true}).click();
    await dialog.getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(page.locator('.thumbnail')).toHaveCount(0);
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ถังขยะ',{exact:true}).click();
    await expect(page.locator('.trash-item')).toHaveCount(3);
    await page.getByRole('button',{name:'ล้างถังขยะ',exact:true}).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('ภาพทั้งหมดในถังขยะจะถูกลบถาวร ไม่สามารถกู้คืนได้')).toBeVisible();
    await back();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.trash-item')).toHaveCount(3);
    await page.getByRole('button',{name:'ล้างถังขยะ',exact:true}).click();
    await dialog.getByRole('button',{name:'ล้างถังขยะ',exact:true}).click();
    await expect(page.locator('.trash-item')).toHaveCount(0);
    await back();
    await expect(page.locator('.trash-modal')).toHaveCount(0);
});
test('back protects unsaved remark and returns from batch confirmation without saving',async({page})=>{
    await seed(page,3);
    const back=()=>page.evaluate(()=>window.dispatchEvent(new Event('native-app-back')));
    await page.locator('.thumbnail').first().click();
    await page.locator('.remark-editor textarea').fill('unsaved');
    await back();
    const dialog=page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await back();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.remark-editor textarea')).toHaveValue('unsaved');
    await back();
    await dialog.getByRole('button',{name:'ปิดโดยไม่บันทึก'}).click();
    await expect(page.locator('.preview-modal')).toHaveCount(0);
    await page.getByRole('button',{name:'เลือก',exact:true}).click();
    await page.locator('.thumbnail').first().click();
    await page.getByRole('button',{name:'แก้ไขที่เลือก'}).click();
    const batch=page.getByRole('dialog',{name:'แก้ไขหลายภาพ'});
    await batch.locator('#batch-remark').selectOption('replace');
    await batch.getByLabel('Remark ใหม่').fill('draft');
    await batch.getByRole('button',{name:'ตรวจสอบการแก้ไข'}).click();
    await back();
    await expect(batch.getByRole('button',{name:'ตรวจสอบการแก้ไข'})).toBeVisible();
    await back();
    await expect(batch).toHaveCount(0);
    await expect(page.locator('.thumbnail[aria-pressed="true"]')).toHaveCount(1);
    await back();
    await expect(page.locator('.thumbnail[aria-pressed="true"]')).toHaveCount(0);
});

test('settings categories preserve config, show live summaries and support hierarchical back',async({page})=>{
    await seed(page,3);
    const back=()=>page.evaluate(()=>window.dispatchEvent(new Event('native-app-back')));
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ตั้งค่า',{exact:true}).click();
    const root=page.locator('.settings-home');
    await expect(root.locator('.settings-category')).toHaveCount(7);
    await expect(page.locator('.settings-section')).toHaveCount(0);
    await root.getByRole('button',{name:'เวลาและ Timestamp',exact:true}).click();
    await expect(page.locator('#settings-time')).toBeVisible();
    await expect(page.locator('#settings-format')).toBeVisible();
    await expect(page.locator('#settings-location')).toHaveCount(0);
    await expect(page.getByRole('switch',{name:'ใช้เวลาปัจจุบัน',exact:true})).toHaveCount(0);
    await expect(page.locator('#settings-time .date-time-wheel-trigger')).toHaveCount(0);
    await back();
    await expect(root.getByRole('button',{name:'เวลาและ Timestamp'})).toContainText('เวลาปัจจุบัน');
    await root.getByRole('button',{name:'ขนาดและสัดส่วนภาพ'}).click();
    await page.locator('#settings-size select').first().selectOption('preset');
    await expect(page.locator('#settings-size select')).toHaveCount(4);
    await back();
    await root.getByRole('button',{name:'ตัวอักษรและการจัดวาง'}).click();
    await expect(page.locator('.overlay-frame-editor')).toBeVisible();
    await expect(page.locator('.alignment-picker svg')).toHaveCount(18);
    await back();
    await root.getByRole('button',{name:'Remark',exact:true}).click();
    await page.getByRole('switch',{name:'แสดง Remark บนรูป'}).click();
    await back();
    await expect(root.getByRole('button',{name:'Remark',exact:true})).toContainText('ปิด');
    await back();
    await expect(page.locator('.settings-modal')).toHaveCount(0);
    await page.reload();
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ตั้งค่า',{exact:true}).click();
    await expect(root.getByRole('button',{name:'เวลาและ Timestamp'})).toContainText('เวลาปัจจุบัน');
    await expect(root.getByRole('button',{name:'Remark',exact:true})).toContainText('ปิด');
});
test('settings map back returns to location category and reset confirmation is safe',async({page})=>{
    await seed(page,2);
    const back=()=>page.evaluate(()=>window.dispatchEvent(new Event('native-app-back')));
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ตั้งค่า',{exact:true}).click();
    await page.locator('.settings-home').getByRole('button',{name:'ตำแหน่ง',exact:true}).click();
    await page.getByRole('button',{name:'เลือกบนแผนที่'}).click();
    await expect(page.locator('.map-modal')).toBeVisible();
    await back();
    await expect(page.locator('#settings-location')).toBeVisible();
    await back();
    await page.locator('.settings-home').getByRole('button',{name:'จัดการแอป',exact:true}).click();
    await page.getByRole('button',{name:'Reset Settings'}).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await back();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('#settings-danger')).toBeVisible();
    await back();
    await expect(page.locator('.settings-home')).toBeVisible();
    await back();
    await expect(page.locator('.settings-modal')).toHaveCount(0);
    await expect(page.locator('.thumbnail')).toHaveCount(2);
});

test('300-photo library supports batch edit, preview, trash and reload',async({page})=>{
    await seed(page,300);
    const rail=page.locator('.gallery-strip[aria-busy]');
    await expect(rail.locator('.thumbnail')).toHaveCount(300);
    await page.getByRole('button',{name:'เลื่อนไปขวาสุด',exact:true}).click();
    await expect.poll(()=>rail.evaluate(el=>Math.abs(el.scrollWidth-el.clientWidth-el.scrollLeft))).toBeLessThan(3);
    await rail.locator('[data-card-id="photo-299"]').click();
    await expect(page.getByRole('heading',{name:'รูปที่ 300 / 300',exact:true})).toBeVisible();
    await expect(page.locator('.active-preview-canvas')).toBeVisible();
    await page.getByRole('button',{name:'รูปก่อนหน้า',exact:true}).click();
    await expect(page.getByRole('heading',{name:'รูปที่ 299 / 300',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'ปิดตัวอย่างภาพ'}).click();
    await expect(page.locator('.preview-modal')).toHaveCount(0);
    await page.getByRole('button',{name:'เลือก',exact:true}).click();
    await page.getByRole('button',{name:'เลือกทั้งหมด',exact:true}).click();
    await page.getByRole('button',{name:'แก้ไขที่เลือก'}).click();
    const modal=page.getByRole('dialog',{name:'แก้ไขหลายภาพ'});
    await modal.locator('#batch-remark').selectOption('replace');
    await modal.getByLabel('Remark ใหม่').fill('stress');
    await modal.getByRole('button',{name:'ตรวจสอบการแก้ไข'}).click();
    await modal.getByRole('button',{name:'ยืนยันบันทึก'}).click();
    await expect(modal).toHaveCount(0);
    await page.getByRole('button',{name:'เพิ่มเติม',exact:true}).click();
    await page.getByRole('button',{name:'ลบที่เลือก',exact:true}).click();
    await page.getByRole('alertdialog').getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(rail.locator('.thumbnail')).toHaveCount(0);
    await page.getByTitle('เมนูเพิ่มเติม',{exact:true}).click();
    await page.getByTitle('ถังขยะ',{exact:true}).click();
    await expect(page.locator('.trash-item')).toHaveCount(300);
    await page.locator('.trash-select-all input').check();
    await page.getByRole('button',{name:'กู้คืน',exact:true}).click();
    await expect(page.locator('.trash-item')).toHaveCount(0);
    await page.reload();
    await expect(rail.locator('.thumbnail')).toHaveCount(300);
    const count=await page.evaluate(async()=>{const {db}=await import('/src/lib/legacyDb.ts');return db.photos.filter(p=>p.remark==='stress'&&p.baseBlob.size>0).count();});
    expect(count).toBe(300);
});

test('preview bottom sheet stays bottom-aligned and supports drag dismissal', async({page})=>{
    await seed(page,4);
    await page.locator('.thumbnail').nth(1).click();
    const sheet=page.locator('.preview-sheet'), grip=page.locator('.preview-sheet-grip');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS('animation-name','preview-sheet-in');
    await sheet.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
    const layout=await sheet.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,height:innerHeight,radius:getComputedStyle(el).borderTopLeftRadius}));
    expect(Math.abs(layout.bottom-layout.height)).toBeLessThan(2);
    expect(layout.radius).toBe('24px');
    const b=(await grip.boundingBox())!,x=b.x+b.width/2,y=b.y+b.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+22,{steps:5});
    await expect.poll(()=>sheet.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBeGreaterThan(15);
    await page.mouse.up();
    await expect.poll(()=>sheet.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBeCloseTo(0,0);
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+120,{steps:12});await page.mouse.up();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('.thumbnail')).toHaveCount(4);
});

test('manual preview deletion requires confirmation, locks repeated taps, and animates direction',async({page})=>{
    await seed(page,4);
    await page.locator('[data-card-id="photo-2"]').click();
    const remove=page.getByRole('button',{name:'ลบรูปนี้',exact:true});
    const dialog=page.getByRole('alertdialog');
    const viewport=page.locator('.preview-canvas-container');
    await expect(page.locator('.active-preview-canvas')).toBeVisible();
    await remove.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText('ย้ายรูปที่ 3 ไปถังขยะ?');
    await expect(page.locator('.thumbnail')).toHaveCount(4);
    await dialog.getByRole('button',{name:'ยกเลิก',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.thumbnail')).toHaveCount(4);
    await remove.click();
    await page.evaluate(()=>window.dispatchEvent(new Event('native-app-back')));
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.thumbnail')).toHaveCount(4);
    await remove.click();
    await dialog.getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(viewport).toHaveAttribute('data-removal-transition','active');
    await expect(remove).toBeDisabled();
    await expect(page.locator('.preview-actions .btn-primary')).toBeDisabled();
    await expect(page.locator('[data-card-id="photo-2"]')).toHaveCount(0);
    const motion=await viewport.locator('.preview-slide[data-relative="0"]').evaluate(el=>el.getAnimations().map(a=>(a.effect as KeyframeEffect).getKeyframes()));
    expect(motion.some(frames=>String(frames[0]?.transform).includes('translate3d(-'))).toBe(true);
    await remove.evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.thumbnail')).toHaveCount(3);
    await expect(remove).toBeEnabled();
    await expect(viewport).not.toHaveAttribute('data-removal-transition','active');
    await expect(page.locator('.preview-removal-outgoing')).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'รูปที่ 2 / 3',exact:true})).toBeVisible();
    await remove.click();
    await dialog.getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(remove).toBeEnabled();
    await remove.click();
    await dialog.getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(viewport).toHaveAttribute('data-removal-transition','active');
    const forward=await viewport.locator('.preview-slide[data-relative="0"]').evaluate(el=>el.getAnimations().map(a=>(a.effect as KeyframeEffect).getKeyframes()));
    expect(forward.some(frames=>String(frames[0]?.transform).match(/translate3d\([1-9]/))).toBe(true);
    await expect(remove).toBeEnabled();
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 1',exact:true})).toBeVisible();
    await expect(page.locator('[data-card-id="photo-3"]')).toHaveCount(1);
});
test('reduced motion keeps the removal safety lock without visual animation',async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});
    await seed(page,2);
    await page.locator('.thumbnail').first().click();
    await page.getByRole('button',{name:'ลบรูปนี้'}).click();
    await page.getByRole('alertdialog').getByRole('button',{name:'ย้ายไปถังขยะ',exact:true}).click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    await expect(page.locator('.preview-removal-outgoing')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'ลบรูปนี้'})).toBeEnabled();
});

async function mockConfirmedPreviewSave(page:Page,mode:'confirmed'|'failed'='confirmed'){
    // Mock only the save boundary. Real library, trash, rendering and UI stay in use.
    await page.route(url=>url.pathname==='/src/lib/download.ts'&&!url.searchParams.has('unmocked'),async route=>{
        await route.fulfill({contentType:'application/javascript',body:`
            export {downloadAll} from '/src/lib/download.ts?unmocked=1';
            export async function downloadOne(){
                window.__previewSaveCalls=(window.__previewSaveCalls||0)+1;
                await new Promise(r=>setTimeout(r,120));
                if('${mode}'==='failed')throw new Error('test disk failure');
                return {confirmed:true};
            }
        `});
    });
}
test('confirmed preview save flies down before replacement and protects against double taps',async({page})=>{
    await mockConfirmedPreviewSave(page);
    await seed(page,3);
    await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('timestamp-settings')??'{}');localStorage.setItem('timestamp-settings',JSON.stringify({...s,autoTrashAfterDownload:true}));});
    await page.reload();
    await page.locator('[data-card-id="photo-1"]').click();
    await expect(page.locator('.active-preview-canvas')).toBeVisible();
    const button=page.locator('.preview-actions .btn-primary'),flight=page.locator('.preview-download-flight');
    await button.click();
    await expect(flight).toBeVisible();
    await expect(page.locator('.preview-canvas-container')).toHaveAttribute('data-download-flight','active');
    await expect(page.getByRole('heading',{name:'รูปที่ 2 / 3',exact:true})).toBeVisible();
    await expect(page.locator('.thumbnail')).toHaveCount(3);
    await expect(button).toBeDisabled();
    const motion=await flight.evaluate(el=>el.getAnimations().map(a=>({frames:(a.effect as KeyframeEffect).getKeyframes(),duration:a.effect!.getTiming().duration})));
    const path=motion.find(a=>a.frames[0].transform)!;
    expect(path.duration).toBe(580);
    const last=String(path.frames.at(-1)!.transform);
    const match=last.match(/translate3d\([^,]+,\s*([\d.]+)px,\s*0(?:px)?\) scale\(([\d.]+)\)/);
    expect(match).not.toBeNull();expect(Number(match![1])).toBeGreaterThan(0);expect(Number(match![2])).toBeLessThan(.25);
    await button.evaluate(el=>(el as HTMLButtonElement).click());
    expect(await page.evaluate(()=>(window as any).__previewSaveCalls)).toBe(1);
    await expect(flight).toHaveCount(0);
    await expect(page.locator('[data-card-id="photo-1"]')).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 2',exact:true})).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(page.locator('.preview-canvas-container')).not.toHaveAttribute('data-download-flight','active');
    await expect(page.locator('.active-preview-canvas')).toBeVisible();
    // Next fallback, then last photo closes only after the flight.
    await button.click();await expect(flight).toBeVisible();
    await expect(page.locator('.thumbnail')).toHaveCount(2);
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 1',exact:true})).toBeVisible();
    await expect(button).toBeEnabled();
    await button.click();await expect(flight).toBeVisible();
    await expect(page.locator('.preview-modal')).toBeVisible();
    await expect(page.locator('.preview-modal')).toHaveCount(0);
    await expect(page.locator('.thumbnail')).toHaveCount(0);
    await expect(flight).toHaveCount(0);
});
test('confirmed preview save without auto trash returns to same image',async({page})=>{
    await mockConfirmedPreviewSave(page);await seed(page,2);
    await page.locator('.thumbnail').first().click();
    await expect(page.locator('.active-preview-canvas')).toBeVisible();
    const button=page.locator('.preview-actions .btn-primary');
    await button.click();await expect(page.locator('.preview-download-flight')).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(page.locator('.thumbnail')).toHaveCount(2);
    await expect(page.getByRole('heading',{name:'รูปที่ 1 / 2',exact:true})).toBeVisible();
    await expect(page.locator('.active-preview-canvas')).toBeVisible();
});
test('failed preview save never flies or removes the photo',async({page})=>{
    await mockConfirmedPreviewSave(page,'failed');await seed(page,2);
    await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('timestamp-settings')??'{}');localStorage.setItem('timestamp-settings',JSON.stringify({...s,autoTrashAfterDownload:true}));});
    await page.reload();await page.locator('.thumbnail').first().click();
    const button=page.locator('.preview-actions .btn-primary');
    await button.click();await expect(page.getByText('ดาวน์โหลดไม่สำเร็จ',{exact:true})).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(page.locator('.preview-download-flight')).toHaveCount(0);
    await expect(page.locator('.thumbnail')).toHaveCount(2);
});
test('reduced motion confirmed preview save skips flight but still replaces photo',async({page})=>{
    await page.emulateMedia({reducedMotion:'reduce'});
    await mockConfirmedPreviewSave(page);await seed(page,2);
    await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('timestamp-settings')??'{}');localStorage.setItem('timestamp-settings',JSON.stringify({...s,autoTrashAfterDownload:true}));});
    await page.reload();await page.locator('.thumbnail').first().click();
    await page.locator('.preview-actions .btn-primary').click();
    await expect(page.locator('.thumbnail')).toHaveCount(1);
    await expect(page.locator('.preview-download-flight')).toHaveCount(0);
    await expect(page.locator('.preview-actions .btn-primary')).toBeEnabled();
});
