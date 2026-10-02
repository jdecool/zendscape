import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The latest snapshot opens first and the scene draws once allocations are loaded.
  await expect(page.locator('#snapshot')).toHaveValue('2');
  await expect(page.locator('#legend li').first()).toBeVisible();
});

test('finds why a leaking object is still alive', async ({ page }) => {
  const inspector = page.locator('.inspector');
  await inspector.getByRole('button', { name: /Product/ }).click();
  await expect(inspector.getByRole('heading', { name: 'Product instances, largest first' })).toBeVisible();

  await inspector.locator('.row').first().click();
  await expect(inspector.getByRole('heading', { name: 'Product', exact: true })).toBeVisible();
  await expect(inspector.getByRole('heading', { name: 'Why is it still alive?' })).toBeVisible();
  const path = inspector.locator('.paths li').first();
  await expect(path).toContainText('class_table');
  await expect(path).toContainText('items');

  await path.getByRole('button', { name: 'items' }).click();
  await expect(inspector.getByRole('heading', { name: 'Array', exact: true })).toBeVisible();
});

test('masks string values until asked', async ({ page }) => {
  const inspector = page.locator('.inspector');
  await inspector.getByRole('button', { name: 'Search' }).click();
  await inspector.getByRole('searchbox').fill('Product #42');
  await expect(inspector.locator('.row').first()).toContainText('String = (hidden)');

  await page.getByText('Show strings').click();
  await expect(inspector.locator('.row').first()).toContainText('String = "Product #42"');
});

test('shows what grew since an earlier snapshot', async ({ page }) => {
  await page.locator('#baseline').selectOption({ label: 'static-cache.t0.rmem' });

  const inspector = page.locator('.inspector');
  await expect(inspector.getByRole('heading', { name: 'Since static-cache.t0.rmem' })).toBeVisible();
  await expect(inspector.getByText('1,000 new objects')).toBeVisible();
  await expect(inspector.locator('.growth li').first()).toContainText('class_table › productcache › static_properties › items');
  await expect(page.locator('#legend')).toContainText('New since the baseline');
  await expect(page.locator('input[name="color"][value="changes"]')).toBeChecked();
});

test('selects an allocation clicked in the scene', async ({ page }) => {
  // Two clicks where the allocations are drawn: if the first lands on a page bar it flies in, the second selects.
  const canvas = page.locator('#scene');
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('No canvas');
  }
  await page.mouse.click(box.x + box.width * 0.36, box.y + box.height * 0.53);
  await page.waitForTimeout(1000);
  await page.mouse.click(box.x + box.width * 0.36, box.y + box.height * 0.5);

  await expect(page.locator('.inspector').getByRole('heading', { name: 'Why is it still alive?' })).toBeVisible();
});
