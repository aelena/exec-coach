import { expect, test, type Page } from '@playwright/test';

const problems: string[] = [];

test.beforeEach(async ({ page }) => {
  problems.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));
});

test.afterEach(() => {
  // Includes Content-Security-Policy violations, which Chrome reports as console errors.
  expect(problems).toEqual([]);
});

async function onboard(page: Page) {
  await page.goto('/');
  await page.getByText('English', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Executive Reflexes' })).toBeVisible();
  await page.getByLabel('Your role').fill('CTO');
  await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled();
  await page.getByLabel('I understand where my data goes').check();
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page.getByRole('heading', { name: 'Quick kata' })).toBeVisible();
}

async function startWrittenKata(page: Page, options: { coaching?: string } = {}) {
  await page.goto('/#/setup');
  await page.getByLabel('Scenario').selectOption('erp-friday-release');
  await page.getByText('Desktop · Writing', { exact: true }).click();
  if (options.coaching) await page.getByText(options.coaching, { exact: true }).click();
  await page.getByRole('button', { name: 'Start kata' }).click();
  await expect(page.getByText('Your mandate:')).toBeVisible();
  await page.getByRole('button', { name: 'Start kata' }).click();
  await expect(page.locator('.turn-actor').first()).toContainText('Only four endpoints left');
}

async function say(page: Page, text: string) {
  await page.getByLabel('Your response').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

test('complete written kata with feedback, causal trace, coach dialogue and persistence', async ({ page }) => {
  await onboard(page);
  await startWrittenKata(page);

  await say(page, 'What evidence do we have today on failure tests and retries?');
  await expect(page.locator('.turn-actor')).toHaveCount(2);
  await say(page, 'I propose a controlled rollout with explicit release criteria.');
  await expect(page.locator('.turn-actor')).toHaveCount(3);

  // Reload mid-session: it comes back paused with every turn, and resumes.
  await page.reload();
  await expect(page.getByText('Session paused.')).toBeVisible();
  await expect(page.locator('.turn')).toHaveCount(5);
  await page.getByRole('button', { name: 'Resume' }).click();

  await say(page, 'I recommend we confirm reconciliation first. Which scope can we release safely?');
  await expect(page.getByRole('heading', { name: 'Coach feedback' })).toBeVisible();
  await expect(page.locator('.evaluation')).toHaveCount(3);
  await expect(page.getByText('Simulated outcome')).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'Kata complete' })).toBeVisible();

  // Untimed coach dialogue with labelled, cited statements.
  await page.getByRole('link', { name: 'Talk it through with the coach' }).click();
  await page.getByLabel('Why did they object?').fill('Why did the CEO resist?');
  await page.getByRole('button', { name: 'Ask the coach' }).click();
  await expect(page.locator('.msg-coach .tag-scenario_fact')).toBeVisible();
  await page.reload();
  await expect(page.locator('.msg-coach')).toHaveCount(1);

  // History keeps the session, its causal trace and the frozen model snapshot.
  await page.goto('/#/history');
  await page.getByRole('link', { name: /ERP Friday release/ }).click();
  await expect(page.getByRole('heading', { name: 'Causal trace' })).toBeVisible();
  await expect(page.getByText('Hidden fact revealed').first()).toBeVisible();
  await expect(page.getByText('Provider demo')).toBeVisible();

  // Dashboard refuses to overclaim from one session.
  await page.goto('/#/dashboard');
  await expect(page.getByText(/Only 1 evaluated session/)).toBeVisible();
  await expect(page.getByText(/Observing: 1 evaluated session/)).toBeVisible();

  // Memory is inspectable: the actor-observable record holds only the trainee's own words.
  await page.goto('/#/memory');
  await expect(page.getByText(/In an earlier meeting/)).toBeVisible();
});

test('immediate coaching allows a retry, and an A/B replay freezes the scenario facts', async ({ page }) => {
  await onboard(page);
  await startWrittenKata(page, { coaching: 'Immediate' });
  await say(page, 'How many tests did you write?');
  await expect(page.getByRole('heading', { name: 'Coach feedback' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.turn-superseded')).toHaveCount(1);
  await say(page, 'What evidence do we need to ship Friday at an acceptable risk?');
  await page.getByRole('button', { name: 'Continue' }).click();
  await say(page, 'I propose we agree the release conditions today.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await say(page, 'I recommend a controlled rollout for the endpoints we can verify.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Kata complete' })).toBeVisible();
  await expect(page.locator('.turn-actor').last()).toContainText('Put that in writing');

  await page.getByRole('button', { name: 'Replay (A/B)' }).click();
  await expect(page.getByText('Replay: same scenario facts')).toBeVisible();
  await page.getByRole('button', { name: 'Start kata' }).click();
  await say(page, 'What do the failure tests show?');
  await page.getByRole('button', { name: 'Continue' }).click();
  // Ending on the trainee's turn closes the kata without another exchange.
  await expect(page.getByLabel('Your response')).toBeVisible();
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByRole('heading', { name: 'Kata complete' })).toBeVisible();

  await page.goto('/#/history');
  await page.getByRole('link', { name: /replay/ }).click();
  await page.locator('a[href^="#/compare/"]').first().click();
  await expect(page.getByText('Both runs used identical scenario facts')).toBeVisible();
  await expect(page.getByText('not statistical proof')).toBeVisible();
});

test('interface switches to Spanish, the library is editable offline, and driving mode is listening-only', async ({ page, context }) => {
  await onboard(page);
  await page.goto('/#/settings');
  await page.getByRole('group', { name: 'Interface language' }).getByText('Español').click();
  await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible();
  await page.getByRole('group', { name: 'Idioma del contenido' }).getByText('Español').click();

  await page.goto('/#/library');
  await expect(page.getByText('¿Qué sabemos y qué estamos suponiendo?')).toBeVisible();
  await page.getByRole('button', { name: 'Añadir pregunta' }).click();
  await page.getByLabel('Pregunta', { exact: true }).fill('¿Quién paga si nos equivocamos?');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('¿Quién paga si nos equivocamos?')).toBeVisible();

  await page.getByRole('tab', { name: 'Actores y escenarios' }).click();
  await expect(page.getByText('CEO impaciente')).toBeVisible();
  await expect(page.getByText('Salida del ERP el viernes')).toBeVisible();

  // Offline: the installed shell, history and library keep working without a network.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Biblioteca' })).toBeVisible();
  await expect(page.getByText('¿Quién paga si nos equivocamos?')).toBeVisible();
  await context.setOffline(false);

  await page.goto('/#/driving');
  await expect(page.getByText('No interactúes con la pantalla mientras conduces')).toBeVisible();
  await expect(page.locator('textarea, input[type="text"]')).toHaveCount(0);
  // Driving can never be selected as a mode for a simulation.
  await page.goto('/#/setup');
  await expect(page.getByText('Driving · Escucha')).toHaveCount(0);
});
