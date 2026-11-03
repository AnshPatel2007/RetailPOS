import { numeric } from '../../utils/money';
import { prisma, seedTestData, TestData } from './setup';
import { api, createTestToken } from './helpers';
import { recordShiftWages, generatePayrollExpenses } from '../../services/payroll.service';
import { randomUUID } from 'crypto';

describe('User-reported POS workflows', () => {
  let data: TestData, admin: string, cashier: string;
  beforeEach(async () => { data = await seedTestData(); admin=await createTestToken(data.adminUser.id,'ADMIN'); cashier=await createTestToken(data.cashierUser.id,'CASHIER'); });
  const anotherStore = () => prisma.location.create({ data: { name:'Partner', address:'2 Street', city:'Chicago',state:'IL',zipCode:'60601',phone:'555',email:'partner@store.test' } });
  const linked = async () => {
    const other=await anotherStore(); const [locationAId,locationBId]=[data.location.id,other.id].sort();
    await prisma.storeConnection.create({data:{locationAId,locationBId,createdBy:data.adminUser.id}});
    const user=await prisma.user.create({data:{email:'partneradmin@test.com',password:data.adminUser.password,firstName:'Partner',lastName:'Owner',role:'ADMIN',locationId:other.id}});
    return { other, token:await createTestToken(user.id,'ADMIN') };
  };
  const createTransfer = (destination:string,quantity=2) => api.post('/api/inventory-transfers').withAuth(admin).withBody({fromLocationId:data.location.id,toLocationId:destination,items:[{productId:data.product.id,quantity}]}).execute();

  it.each(['ADMIN', 'MANAGER'] as const)('includes the store at login so a %s can create a transfer immediately', async (role) => {
    await prisma.user.update({ where: { id: data.adminUser.id }, data: { role } });
    const { other } = await linked();
    const login = await api.post('/api/auth/login').withBody({ email: data.adminUser.email, password: 'Admin123!' }).expectStatus(200).execute();
    const { token, user } = login.body.data;
    expect(user.locationId).toBe(data.location.id);
    expect(user.locationId).toBe(user.location.id);
    expect(user.role).toBe(role);
    const options = await api.get('/api/inventory-transfers/options').withAuth(token).withQuery({ locationId: user.locationId }).expectStatus(200).execute();
    expect(options.body.data.source.id).toBe(user.locationId);
    const transfer = await api.post('/api/inventory-transfers').withAuth(token).withBody({ fromLocationId: user.locationId, toLocationId: other.id, items: [{ productId: data.product.id, quantity: 1 }] }).expectStatus(201).execute();
    expect(transfer.body.data.fromLocationId).toBe(user.locationId);
    expect(transfer.body.data.status).toBe('PENDING');
  });

  it('quotes current price and tax before charging the 89.98 cart',async()=>{
    await prisma.location.update({where:{id:data.location.id},data:{taxRate:8.875}});
    await prisma.product.update({where:{id:data.product.id},data:{price:44.99}});
    const items=[{productId:data.product.id,quantity:2,price:19.99}];
    const quote=await api.post('/api/sales/quote').withAuth(cashier).withBody({items}).expectStatus(200).execute();
    expect(quote.body.data.totalTax).toBe(7.99); expect(quote.body.data.total).toBe(97.97);
    await api.post('/api/shifts/clock-in').withAuth(cashier).withBody({startingCash:0}).expectStatus(201).execute();
    const result=await api.post('/api/sales').withAuth(cashier).withBody({items,paymentMethod:'CASH',amountPaid:97.97,expectedTotal:97.97}).expectStatus(201).execute();
    expect(result.body.data.total).toBe(quote.body.data.total);
  });
  it('rejects stale confirmed totals before any stock changes',async()=>{
    await api.post('/api/shifts/clock-in').withAuth(cashier).withBody({startingCash:0}).execute();
    await api.post('/api/sales').withAuth(cashier).withBody({items:[{productId:data.product.id,quantity:1,price:19.99}],paymentMethod:'CASH',amountPaid:19.99,expectedTotal:19.99}).expectStatus(409).execute();
    expect(await prisma.sale.count()).toBe(0);
  });
  it('applies owner tax settings but leaves exempt products untaxed',async()=>{
    await api.put('/api/locations/my-settings').withAuth(admin).withBody({storeInfo:{storeName:'Test',taxRate:8.875}}).expectStatus(200).execute();
    await prisma.product.update({where:{id:data.product.id},data:{isTaxable:false}});
    const res=await api.post('/api/sales/quote').withAuth(cashier).withBody({items:[{productId:data.product.id,quantity:1,price:19.99}]}).expectStatus(200).execute();
    expect(res.body.data.total).toBe(19.99);expect(res.body.data.totalTax).toBe(0);
  });
  it('excludes internal MISC from catalog and separates zero from low-stock counts',async()=>{
    await prisma.product.create({data:{sku:'MISC-001',name:'Misc Item',price:0,trackInventory:false,locationId:data.location.id}});
    await prisma.product.update({where:{id:data.product.id},data:{stockQuantity:0}});
    const products=await api.get('/api/products').withAuth(admin).expectStatus(200).execute();
    expect(products.body.data.some((p:any)=>p.sku==='MISC-001')).toBe(false);
    const stats=await api.get('/api/products/stats').withAuth(admin).expectStatus(200).execute();
    expect(stats.body.data.outOfStockCount).toBe(1);expect(stats.body.data.lowStockCount).toBe(0);
  });
  it('only shows connected destinations to the source store',async()=>{
    const {other}=await linked();await anotherStore();
    const res=await api.get('/api/inventory-transfers/options').withAuth(admin).expectStatus(200).execute();
    expect(res.body.data.source.id).toBe(data.location.id);
    expect(res.body.data.destinations.map((l:any)=>l.id)).toEqual([other.id]);
    await api.post('/api/inventory-transfers/connections').withAuth(admin).withBody({fromLocationId:data.location.id,toLocationId:other.id}).expectStatus(403).execute();
  });
  it('super-admin can connect stores with separate owners',async()=>{
    const other=await anotherStore();await prisma.user.update({where:{id:data.adminUser.id},data:{role:'SUPER_ADMIN'}});
    admin = await createTestToken(data.adminUser.id, 'SUPER_ADMIN');
    await api.post('/api/inventory-transfers/connections').withAuth(admin).withBody({fromLocationId:data.location.id,toLocationId:other.id}).expectStatus(201).execute();
    expect(await prisma.storeConnection.count()).toBe(1);
  });
  it('rejects unconnected stores, wrong sources, duplicates, and transferring 100 of 99',async()=>{
    const unrelated=await anotherStore(); expect((await createTransfer(unrelated.id)).status).toBe(403);
    const {other}=await linked();await prisma.product.update({where:{id:data.product.id},data:{stockQuantity:99}});
    expect((await createTransfer(other.id,100)).status).toBe(400);
    await api.post('/api/inventory-transfers').withAuth(admin).withBody({fromLocationId:other.id,toLocationId:data.location.id,items:[{productId:data.product.id,quantity:1}]}).expectStatus(403).execute();
    await api.post('/api/inventory-transfers').withAuth(admin).withBody({fromLocationId:data.location.id,toLocationId:other.id,items:[{productId:data.product.id,quantity:60},{productId:data.product.id,quantity:60}]}).expectStatus(400).execute();
  });
  it('ships once under concurrency and receives into a different destination product ID',async()=>{
    const {other,token}=await linked();
    const destination=await prisma.product.create({data:{sku:data.product.sku,name:data.product.name,price:19.99,stockQuantity:5,locationId:other.id}});
    const transfer=(await createTransfer(other.id)).body.data;
    const ships=await Promise.all([1,2].map(()=>api.post('/api/inventory-transfers/'+transfer.id+'/ship').withAuth(admin).execute()));
    expect(ships.map(r=>r.status).sort()).toEqual([200,400]);
    await api.post('/api/inventory-transfers/'+transfer.id+'/receive').withAuth(admin).expectStatus(403).execute();
    const receipt = { idempotencyKey: randomUUID(), items: [{ transferItemId: transfer.items[0].id, acceptedQty: 2, destinationProductId: destination.id }] };
    await api.post('/api/inventory-transfers/'+transfer.id+'/receive').withAuth(token).withBody(receipt).expectStatus(200).execute();
    await api.post('/api/inventory-transfers/'+transfer.id+'/receive').withAuth(token).withBody(receipt).expectStatus(200).execute();
    expect((await prisma.product.findUniqueOrThrow({where:{id:destination.id}})).stockQuantity).toBe(7);
    expect((await prisma.product.findUniqueOrThrow({where:{id:data.product.id}})).stockQuantity).toBe(98);
  });
  it('rechecks availability when shipping an older draft',async()=>{
    const {other}=await linked();const t=(await createTransfer(other.id,50)).body.data;
    await prisma.product.update({where:{id:data.product.id},data:{stockQuantity:49}});
    await api.post('/api/inventory-transfers/'+t.id+'/ship').withAuth(admin).expectStatus(400).execute();
    expect((await prisma.product.findUniqueOrThrow({where:{id:data.product.id}})).stockQuantity).toBe(49);
  });
  it('rate changes only affect future shifts and clock-out records earned wages',async()=>{
    await api.put('/api/payroll/employees/'+data.cashierUser.id+'/rate').withAuth(admin).withBody({hourlyRate:20}).expectStatus(200).execute();
    const shift=(await api.post('/api/shifts/clock-in').withAuth(cashier).withBody({startingCash:0}).expectStatus(201).execute()).body.data;
    expect(shift).not.toHaveProperty('hourlyRate');
    expect(numeric((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).hourlyRate)).toBe(20);
    const store=(await api.get('/api/locations/'+data.location.id).withAuth(cashier).expectStatus(200).execute()).body.data;
    expect(store.activeShifts).toHaveLength(1);
    expect(store.activeShifts[0]).not.toHaveProperty('hourlyRate');
    expect(store.activeShifts[0]).not.toHaveProperty('payrollEntries');
    await api.put('/api/payroll/employees/'+data.cashierUser.id+'/rate').withAuth(admin).withBody({hourlyRate:30}).expectStatus(200).execute();
    await prisma.shift.update({where:{id:shift.id},data:{clockInAt:new Date(Date.now()-7200000)}});
    await api.post('/api/shifts/clock-out').withAuth(cashier).withBody({endingCash:0}).expectStatus(200).execute();
    const rows=await prisma.payrollEntry.findMany();expect(rows.length).toBeGreaterThan(0);expect(numeric(rows[0].hourlyRate)).toBe(20);
    expect(rows.reduce((s,r)=>s+Number(r.grossPay),0)).toBeCloseTo(40,1);
  });
  it('posts each completed pay period once and protects its calculated expense',async()=>{
    const shift=await prisma.shift.create({data:{userId:data.cashierUser.id,locationId:data.location.id,clockInAt:new Date('2026-01-20T14:00:00Z'),clockOutAt:new Date('2026-01-20T22:00:00Z'),isClosed:true,hourlyRate:20,payrollFrequency:'WEEKLY',payrollTimezone:'America/Chicago'}});
    await prisma.$transaction(tx=>recordShiftWages(tx,shift));
    expect(await generatePayrollExpenses(new Date('2026-02-01T12:00:00Z'))).toBe(1);
    expect(await generatePayrollExpenses(new Date('2026-02-01T12:00:00Z'))).toBe(0);
    const expense=await prisma.expense.findFirstOrThrow({where:{category:'PAYROLL'}});expect(numeric(expense.amount)).toBe(160);expect(expense.status).toBe('PENDING');
    await api.delete('/api/expenses/'+expense.id).withAuth(admin).expectStatus(400).execute();
    await api.put('/api/expenses/'+expense.id).withAuth(admin).withBody({amount:1}).expectStatus(400).execute();
  });
  it('cashiers cannot view payroll or change their wage, and admins cannot edit another store',async()=>{
    await api.get('/api/payroll').withAuth(cashier).expectStatus(403).execute();
    await api.put('/api/payroll/employees/'+data.cashierUser.id+'/rate').withAuth(cashier).withBody({hourlyRate:100}).expectStatus(403).execute();
    const {token}=await linked();
    await api.put('/api/payroll/employees/'+data.cashierUser.id+'/rate').withAuth(token).withBody({hourlyRate:100}).expectStatus(403).execute();
  });
});
