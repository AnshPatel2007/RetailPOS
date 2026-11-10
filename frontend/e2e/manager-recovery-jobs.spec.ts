import { chooseOption, selectField } from './utils/select-helper';
import {test,expect} from '@playwright/test';
import {login} from './utils/auth-helper';

test('owner correction recovery records one immutable adjustment after a lost response',async({page})=>{
  await login(page,'recon@example.test');await page.goto('/financial/reconciliation');
  await page.getByRole('button',{name:'Review current balance',exact:true}).click();
  await expect(page.getByText('Your open drawer: $100.00',{exact:true})).toBeVisible();
  await page.getByLabel('Signed correction amount',{exact:true}).fill('5');await page.getByLabel('Correction reason',{exact:true}).fill('Verified till correction');await page.getByLabel('Evidence reference',{exact:true}).fill('TILL-PROOF-5');
  let original:unknown;await page.route('**/api/financial/reconciliation/corrections',async route=>{original=route.request().postDataJSON();const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');},{times:1});
  await page.getByRole('button',{name:'Record correction',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Result uncertain');
  await page.reload();const saved=page.waitForResponse(response=>response.url().endsWith('/reconciliation/corrections')&&response.status()===200);await page.getByRole('button',{name:'Retry saved operation',exact:true}).click();
  const response=await saved;expect(response.request().postDataJSON()).toEqual(original);expect((await response.json()).replayed).toBe(true);
  const receipt=page.getByRole('dialog',{name:'Correction Receipt',exact:true});await expect(receipt).toContainText('TILL-PROOF-5');await page.keyboard.press('Escape');
  const auth={Authorization:'Bearer '+await page.evaluate(()=>localStorage.getItem('token'))};expect((await(await page.request.get('/api/shifts/current',{headers:auth})).json()).data.expectedDrawer).toBe(105);
  await page.getByRole('button',{name:'Correction History',exact:true}).click();await expect(page.getByText('Verified till correction',{exact:false})).toBeVisible();
});

test('manager books verified queued cash without repricing and retains the original browser evidence',async({page})=>{
  await login(page,'offline-manager@example.test');await page.goto('/pos');
  const auth={Authorization:'Bearer '+await page.evaluate(()=>localStorage.getItem('token'))};
  const shift=(await(await page.request.get('/api/shifts/current',{headers:auth})).json()).data;
  const product=(await(await page.request.get('/api/products?search=FIXTURE-BULK-VOID',{headers:auth})).json()).data[0];
  const localId=crypto.randomUUID();
  const cash={localId,userId:shift.userId,locationId:shift.locationId,payload:{offlineShiftId:shift.id},items:[{productId:product.id,productName:'Original cash receipt',sku:product.sku,quantity:1,price:10,discount:0,tax:1,total:11,pointsEarned:0}],subtotal:10,tax:1,discount:0,total:11,paymentMethod:'CASH',amountPaid:20,changeDue:9,createdAt:Date.now(),synced:false,syncAttempts:5};
  await page.evaluate(async record=>{await new Promise<void>((resolve,reject)=>{const open=indexedDB.open('POSOfflineDB');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('pendingSales','readwrite');tx.objectStore('pendingSales').add(record);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});},cash);
  expect((await page.request.put('/api/products/'+product.id,{headers:auth,data:{price:12}})).status()).toBe(200);
  await page.getByRole('button',{name:'Register recovery and connection status'}).click();const review=page.getByRole('dialog',{name:'Register recovery',exact:true});
  await review.getByRole('button',{name:/Review cash \$11\.00/}).click();await chooseOption(selectField(review, 'Verified outcome'), 'Book the verified original cash receipt');
  await review.getByLabel('Reconciliation reason',{exact:true}).fill('Original receipt verified against drawer');await review.getByLabel('Original evidence reference',{exact:true}).fill('OFFLINE-PROOF-11');await review.getByRole('checkbox',{name:/I checked original records/}).check();
  await review.getByRole('button',{name:'Record reviewed outcome',exact:true}).click();await expect(review.getByRole('heading',{name:'Pending cash sales (0)',exact:true})).toBeVisible();
  await expect(review).toContainText('Book Cash: Done');
  const state=await page.evaluate(async()=>new Promise<any[]>((resolve,reject)=>{const open=indexedDB.open('POSOfflineDB');open.onsuccess=()=>{const db=open.result,tx=db.transaction('pendingSales','readonly'),query=tx.objectStore('pendingSales').getAll();query.onsuccess=()=>{resolve(query.result);db.close();};query.onerror=()=>reject(query.error);};}));
  expect(state.find(record=>record.localId===localId)).toMatchObject({synced:true,reconciliation:{status:'FINAL'}});
  expect((await(await page.request.get('/api/shifts/current',{headers:auth})).json()).data.expectedDrawer).toBe(111);
  expect((await(await page.request.get('/api/products/'+product.id,{headers:auth})).json()).data).toMatchObject({price:12,stockQuantity:product.stockQuantity-1});
});

test('export queue survives a lost response and shows stable job details on phone and desktop',async({page},info)=>{
  await login(page,'jobs@example.test');await page.goto('/settings/jobs');await page.getByRole('button',{name:/^Export dates:/}).click();const dates=page.getByRole('dialog',{name:'Export dates',exact:true});await dates.getByLabel('From date',{exact:true}).fill('2026-10-01');await dates.getByLabel('Through date',{exact:true}).fill('2026-10-19');await dates.getByRole('button',{name:'Apply',exact:true}).click();
  let original:unknown;await page.route('**/api/jobs/exports',async route=>{original=route.request().postDataJSON();const response=await route.fetch();expect(response.status()).toBe(202);await route.abort('failed');},{times:1});
  await page.getByRole('button',{name:'Queue export',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Result uncertain');await page.reload();
  const saved=page.waitForResponse(response=>response.url().endsWith('/jobs/exports')&&response.status()===202);await page.getByRole('button',{name:'Retry saved operation',exact:true}).click();const response=await saved;expect(response.request().postDataJSON()).toEqual(original);expect((await response.json()).replayed).toBe(true);
  const dialog=page.getByRole('dialog',{name:'Job Details',exact:true});await expect(dialog).toContainText('Queued');await expect(page).toHaveURL(/job=/);await page.reload();await expect(dialog).toContainText('No delivery attempts yet.');
  await page.screenshot({path:info.outputPath('job-desktop-light.png'),fullPage:true,animations:'disabled'});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'));await page.screenshot({path:info.outputPath('job-phone-dark.png'),fullPage:true,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('failed job detail refresh disables reviewed retry and keyboard skips the disabled fieldset', async ({ page }) => {
  await login(page, 'jobs@example.test');
  await page.clock.install();
  const id = '10000000-0000-4000-8000-000000000075';
  const job = { id, kind: 'EMAIL', status: 'REVIEW', label: 'Browser review fixture', attempts: 1, maxAttempts: 3,
    createdAt: new Date().toISOString(), availableAt: new Date().toISOString(), finishedAt: null, lastError: 'RESULT_UNKNOWN', result: null };
  await page.route('**/api/jobs?*', route => route.fulfill({ json: { success: true, data: { jobs: [job],
    pagination: { page: 1, total: 2, totalPages: 1 }, counts: { QUEUED: 1, REVIEW: 1 }, oldestWaitingAt: null, workerDisabled: true } } }));
  let unavailable = false, retryRequests = 0;
  await page.route('**/api/jobs/' + id, route => unavailable
    ? route.fulfill({ status: 503, json: { error: 'Latest job status temporarily unavailable' } })
    : route.fulfill({ json: { success: true, data: { ...job, history: [], destination: 'fixture@example.test', providerCorrelationId: id } } }));
  page.on('request', request => { if (request.url().endsWith('/jobs/' + id + '/retry')) retryRequests += 1; });
  await page.goto('/settings/jobs');
  await page.getByRole('button', { name: 'View job', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Job Details', exact: true });
  const submit = dialog.getByRole('button', { name: 'Queue reviewed retry', exact: true });
  await expect(submit).toBeDisabled();
  unavailable = true;
  await page.clock.fastForward(10000);
  await expect(dialog.getByRole('alert')).toContainText('Latest job status temporarily unavailable');
  await expect(submit).toBeDisabled();
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const retryRead = dialog.getByRole('button', { name: 'Retry details', exact: true });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator('summary')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(retryRead).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.locator('summary')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  expect(retryRequests).toBe(0);
  unavailable = false;
  await retryRead.click();
  await expect(dialog.getByLabel('Retry reason', { exact: true })).toBeEnabled();
  await dialog.getByLabel('Retry reason', { exact: true }).fill('Provider history checked');
  await dialog.getByRole('checkbox', { name: /I checked provider history/ }).check();
  await expect(submit).toBeEnabled();
  unavailable = true;
  await page.clock.fastForward(10000);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(submit).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('closing a pending offline hold retains its recovery key until the local receipt is applied', async ({ page }) => {
  await login(page, 'offline-manager@example.test');
  await page.goto('/pos');
  const auth = { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token')) };
  const shift = (await (await page.request.get('/api/shifts/current', { headers: auth })).json()).data;
  const localId = crypto.randomUUID(), receiptId = crypto.randomUUID();
  const record = { localId, userId: shift.userId, locationId: shift.locationId, payload: { offlineShiftId: shift.id }, items: [],
    subtotal: 7, tax: 0, discount: 0, total: 7, paymentMethod: 'CASH', amountPaid: 7, changeDue: 0, createdAt: Date.now(), synced: false, syncAttempts: 5 };
  await page.evaluate(async value => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('POSOfflineDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction('pendingSales', 'readwrite'); tx.objectStore('pendingSales').add(value);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }), record);
  let release!: () => void, sent!: () => void, finished!: () => void, saved: unknown;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { sent = resolve; });
  const completed = new Promise<void>(resolve => { finished = resolve; });
  const result = { localId, cashierId: shift.userId, kind: 'CASH', disposition: 'HOLD', status: 'HOLD', amount: 7,
    reason: 'Investigate the original receipt', reference: 'HOLD-EVIDENCE-7' };
  await page.route('**/api/offline/reconcile', async route => {
    saved = route.request().postDataJSON(); sent(); await held;
    await route.fulfill({ json: { success: true, receiptId, data: result } }); finished();
  }, { times: 1 });
  await page.getByRole('button', { name: 'Register recovery and connection status', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Register recovery', exact: true });
  await review.getByRole('button', { name: /Review cash \$7\.00/ }).click();
  await review.getByLabel('Reconciliation reason', { exact: true }).fill(result.reason);
  await review.getByLabel('Original evidence reference', { exact: true }).fill(result.reference);
  await review.getByRole('checkbox', { name: /I checked original records/ }).check();
  await review.getByRole('button', { name: 'Record reviewed outcome', exact: true }).click();
  await requested;
  await review.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(review).toHaveCount(0);
  release(); await completed;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const key = `pos-pending-operation:offline:${shift.locationId}:${shift.userId}`;
  expect(await page.evaluate(value => localStorage.getItem(value), key)).not.toBeNull();
  await page.route('**/api/offline/reconcile', route => {
    expect(route.request().postDataJSON()).toEqual(saved);
    return route.fulfill({ json: { success: true, receiptId, data: result, replayed: true } });
  });
  await page.getByRole('button', { name: 'Register recovery and connection status', exact: true }).click();
  await review.getByRole('button', { name: 'Retry saved operation', exact: true }).click();
  await expect(review).toContainText('Hold: On hold');
  await expect.poll(async () => page.evaluate(async id => new Promise<string | undefined>((resolve, reject) => {
    const open = indexedDB.open('POSOfflineDB'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction('pendingSales', 'readonly'), query = tx.objectStore('pendingSales').getAll();
      query.onsuccess = () => { resolve(query.result.find(value => value.localId === id)?.reconciliation?.status); db.close(); };
      query.onerror = () => reject(query.error); };
  }), localId)).toBe('HOLD');
  expect(await page.evaluate(value => localStorage.getItem(value), key)).toBeNull();
});
