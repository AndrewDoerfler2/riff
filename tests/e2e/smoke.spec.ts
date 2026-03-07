import { expect, test } from '@playwright/test';

test.describe('Riff DAW smoke', () => {
  test('loads core shell and responds to basic interactions', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('RIFF')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bounce WAV' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI' })).toBeVisible();

    await page.getByRole('button', { name: 'AI' }).click();
    await expect(page.getByRole('button', { name: 'AI Backing Track' })).toBeVisible();

    const projectName = page.getByLabel('Project name');
    await projectName.fill('Smoke E2E Project');
    await expect(projectName).toHaveValue('Smoke E2E Project');
  });
});
