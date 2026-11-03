import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../server';
import { prisma, seedTestData } from './setup';
import { createTestToken } from './helpers';
import { getFinancialMetrics, getProductFinancialMetrics } from '../../services/financialMetrics.service';
import { getSalesReportData, salesReportCSV } from '../../services/salesReport.service';
import { getReportCalendar } from '../../services/reportDates.service';
import { AuthRequest } from '../../types';

describe('simulated full trading day reconciles every monetary boundary',()=>{
  it('reconciles sales, returns, original gift reversal, funded liabilities, payroll and counted cash',async()=>{
    const data=await seedTestData(),token=await createTestToken(data.adminUser.id,'ADMIN');
    const post=(path:string,body:object)=>request(app).post('/api'+path).set('Authorization','Bearer '+token).send(body);
    const get=(path:string,auth=token)=>request(app).get('/api'+path).set('Authorization','Bearer '+auth);
    await prisma.product.update({where:{id:data.product.id},data:{price:10,cost:4,minimumAge:21}});
    await prisma.location.update({where:{id:data.location.id},data:{timezone:'America/Chicago'}});
    await post('/financial/inventory-costs/opening', { idempotencyKey: randomUUID(), notes: 'Verified opening count and cost',
      items: [{ productId: data.product.id, quantity: 100, value: 400, expectedVersion: data.product.stockVersion }] }).expect(200);
    const shift=(await post('/shifts/clock-in',{startingCash:100}).expect(201)).body.data;
    const card=(await post('/gift-cards',{amount:50,paymentMethod:'CASH',idempotencyKey:randomUUID()}).expect(201)).body.data;
    await post('/store-credit/'+data.customer.id+'/credit',{amount:20,source:'GOODWILL',notes:'Verified opening customer credit',idempotencyKey:randomUUID()}).expect(200);
    const account=await prisma.houseAccount.create({data:{customerId:data.customer.id,locationId:data.location.id,creditLimit:100,balance:0}});
    const sale=async(method:string,quantity=1,reference?:string)=>{
      const input={idempotencyKey:randomUUID(),customerId:data.customer.id,items:[{productId:data.product.id,quantity,price:10}],paymentMethod:method,amountPaid:11*quantity,
        ageVerification:{method:'VISUAL'},payments:[{paymentMethod:method,amount:11*quantity,...(reference?{reference}:{})}]};
      return (await post('/sales',input).expect(201)).body.data;
    };
    await post('/sales',{items:[{productId:data.product.id,quantity:1,price:10}],paymentMethod:'CASH',amountPaid:11}).expect(400);
    const giftSale=await sale('GIFT_CARD',1,card.code),cashSale=await sale('CASH',2);
    await sale('STORE_CREDIT');await sale('HOUSE_ACCOUNT');
    const housePayment={amount:11,paymentMethod:'CASH',idempotencyKey:randomUUID()};
    await post('/house-accounts/'+account.id+'/payment',housePayment).expect(200);await post('/house-accounts/'+account.id+'/payment',housePayment).expect(200);
    const refund={idempotencyKey:randomUUID(),items:[{saleItemId:cashSale.items[0].id,quantity:1}],expectedAmount:11,reason:'One unit returned',refundMethod:'CASH'};
    await post('/sales/'+cashSale.id+'/refund',refund).expect(200);await post('/sales/'+cashSale.id+'/refund',refund).expect(200);
    const voidInput={idempotencyKey:randomUUID(),reason:'Duplicate gift-card sale'};
    await post('/sales/'+giftSale.id+'/void',voidInput).expect(200);await post('/sales/'+giftSale.id+'/void',voidInput).expect(200);
    let payroll=await prisma.expense.create({data:{expenseNumber:'FULL-DAY-PAYROLL',category:'PAYROLL',description:'Verified straight-time wages',amount:10,userId:data.adminUser.id,locationId:data.location.id}});
    const review=(action:string)=>({idempotencyKey:randomUUID(),action,expectedAmount:10,expectedUpdatedAt:payroll.updatedAt.toISOString(),reason:'Trading-day wage reconciliation'});
    await post('/payroll/expenses/'+payroll.id+'/review',review('APPROVE')).expect(200);
    payroll=await prisma.expense.findUniqueOrThrow({where:{id:payroll.id}});
    const payment={...review('PAY'),paymentMethod:'DRAWER_CASH',reference:'SIGNED-WAGES-10',paidAt:new Date().toISOString()};
    await post('/payroll/expenses/'+payroll.id+'/review',payment).expect(200);await post('/payroll/expenses/'+payroll.id+'/review',payment).expect(200);
    await prisma.expense.create({data:{expenseNumber:'FULL-DAY-EXTERNAL-EXPENSE',category:'OTHER',description:'Verified external operating payment',amount:5,status:'PAID',paidDate:new Date(),userId:data.adminUser.id,locationId:data.location.id}});
    expect((await get('/shifts/current').expect(200)).body.data.expectedDrawer).toBe(162);
    const closed=(await post('/shifts/clock-out',{endingCash:162}).expect(200)).body.data;
    expect(closed).toMatchObject({expectedCash:162,cashDifference:0});
    const z=(await get('/shifts/'+shift.id+'/z-report').expect(200)).body.data;
    expect(z).toMatchObject({expectedCash:162,cashSales:22,cashRefunds:11,cashGiftFunding:50,cashHousePayments:11});
    const calendar=await getReportCalendar({locationId:data.location.id}),range={gte:calendar.day(),lte:calendar.now};
    const metrics=await getFinancialMetrics({locationId:data.location.id},range);
    expect(metrics).toMatchObject({grossCollected:55,refunds:11,voids:11,netCollected:33,netTax:3,netSales:30,costOfGoodsSold:12,grossProfit:18,expenses:15,operatingProfit:3,transactions:4});
    expect((await getProductFinancialMetrics({locationId:data.location.id},range))[0]).toMatchObject({quantitySold:3,revenue:33,profit:18});
    expect(Number((await prisma.giftCard.findUniqueOrThrow({where:{id:card.id}})).currentBalance)).toBe(50);
    expect(Number((await prisma.storeCreditAccount.findUniqueOrThrow({where:{customerId:data.customer.id}})).balance)).toBe(9);
    expect(Number((await prisma.houseAccount.findUniqueOrThrow({where:{id:account.id}})).balance)).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({where:{id:data.product.id}})).stockQuantity).toBe(97);
    const report=await getSalesReportData({user:{id:data.adminUser.id,role:'ADMIN',locationId:data.location.id},query:{startDate:calendar.day().toISOString(),endDate:calendar.now.toISOString()}} as unknown as AuthRequest);
    expect(report.entries.reduce((sum,row)=>sum+Math.round(row.total*100),0)).toBe(3300);expect(report.summary.totalSales).toBe(metrics.netCollected);
    expect(salesReportCSV(report)).toContain('VOID');
    const manager=await prisma.user.create({data:{email:'full-day-manager@test.com',password:'unused',firstName:'Review',lastName:'Manager',role:'MANAGER',locationId:data.location.id}});
    const managerToken=await createTestToken(manager.id,'MANAGER');
    const managerView=(await get('/shifts/'+shift.id+'/z-report',managerToken).expect(200)).body;
    expect(JSON.stringify(managerView)).not.toMatch(/FULL-DAY-PAYROLL|SIGNED-WAGES-10|payroll:|hourlyRate|grossPay/);
  });
});
