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
    await page.getByTitle('ถังขยะ', { exact: true }).click();
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
    await page.getByRole('button', { name: 'จัดเรียง', exact: true }).click();
    const first = page.locator('.thumbnail').nth(0);
    const third = page.locator('.thumbnail').nth(2);
    const start = (await first.boundingBox())!;
    const end = (await third.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect.poll(() => savedOrder(page)).toEqual(['photo-1', 'photo-2', 'photo-0', 'photo-3']);
    await expect(page.getByRole('button', { name: 'เสร็จสิ้น', exact: true })).toBeEnabled();
    const keyboardStart = (await page.locator('.thumbnail').first().boundingBox())!;
    await page.locator('.thumbnail').first().focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.is-dragging')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await page.locator('.is-dragging').boundingBox())!.x).toBeGreaterThan(keyboardStart.x + 20);
    await page.keyboard.press('Space');
    await expect.poll(() => savedOrder(page)).toEqual(['photo-2', 'photo-1', 'photo-0', 'photo-3']);
    await page.getByRole('button', { name: 'เสร็จสิ้น', exact: true }).click();
    await page.locator('.thumbnail').first().click();
    await expect(page.getByRole('heading', { name: 'รูปที่ 1 / 4', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.thumbnail')).toHaveCount(4);
    expect(await savedOrder(page)).toEqual(['photo-2', 'photo-1', 'photo-0', 'photo-3']);
    await page.getByRole('button', { name: 'จัดเรียง', exact: true }).click();
    await page.screenshot({ path: `test-results/sorting-${test.info().project.name}.png` });
});

test('deleting a card during background trash loading does not lose or duplicate it', async ({ page }) => {
    await seed(page, 4, 300);
    await page.locator('.thumbnail').first().click();
    await page.getByRole('button', { name: 'ลบรูปนี้', exact: false }).click();
    await expect(page.locator('.thumbnail')).toHaveCount(3);
    await page.getByRole('button', { name: 'เปิดถังขยะ', exact: true }).click();
    await expect(page.locator('.trash-item')).toHaveCount(301);
    await expect(page.locator('.trash-load-status')).toHaveCount(0);
    await expect(page.locator('.trash-item strong', { hasText: /^fixture-0$/ })).toHaveCount(1);
});

test('touch drag reorders cards on mobile', async ({ page, context, isMobile }) => {
    test.skip(!isMobile, 'Touch gesture is covered by the mobile project');
    await seed(page);
    await page.getByRole('button', { name: 'จัดเรียง', exact: true }).click();
    const start = (await page.locator('.thumbnail').nth(0).boundingBox())!;
    const end = (await page.locator('.thumbnail').nth(2).boundingBox())!;
    const session = await context.newCDPSession(page);
    const y = start.y + start.height / 2;
    const x = start.x + start.width / 2;
    const targetX = end.x + end.width / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (targetX - x) * step / 12, y }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => savedOrder(page)).toEqual(['photo-1', 'photo-2', 'photo-0', 'photo-3']);
    await session.detach();
});

test('dragging near the edge scrolls the gallery and preserves every card', async ({ page }) => {
    await seed(page, 30);
    await page.getByRole('button', { name: 'จัดเรียง', exact: true }).click();
    await page.locator('.gallery-strip').evaluate((element) => { element.scrollLeft = 0; });
    await expect.poll(() => page.locator('.gallery-strip').evaluate((element) => element.scrollLeft)).toBeLessThan(128);
    // Start from a fully visible card, including mobile's scroll anchoring offset.
    const first = (await page.locator('.thumbnail').nth(2).boundingBox())!;
    const strip = (await page.locator('.gallery-strip').boundingBox())!;
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2 + 12, first.y + first.height / 2, { steps: 3 });
    await expect(page.locator('.is-dragging')).toBeVisible();
    await page.mouse.move(strip.x + strip.width - 8, first.y + first.height / 2, { steps: 30 });
    await expect.poll(() => page.locator('.gallery-strip').evaluate((element) => element.scrollLeft)).toBeGreaterThan(150);
    await page.mouse.move(strip.x + strip.width / 2, first.y + first.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await savedOrder(page)).length).toBe(30);
    expect(new Set(await savedOrder(page)).size).toBe(30);
    await expect(page.locator('.thumbnail')).toHaveCount(30);
});
