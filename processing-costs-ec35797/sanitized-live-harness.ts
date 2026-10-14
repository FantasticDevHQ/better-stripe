import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';import {componentsGeneric} from 'convex/server';
import {BetterStripe} from '<repo>/src/client/index.ts';import {getStripeClient} from '<repo>/src/client/helpers.ts';
process.chdir('<repo>');
const key=execFileSync('pnpm',['exec','convex','env','get','STRIPE_SECRET_KEY','--deployment','<non-connect-sandbox>'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert(key.startsWith('sk_test_'));
const sdk=getStripeClient(key,'2026-09-30.preview');assert.equal((await sdk.accounts.retrieve()).id,'<sandbox-merchant-id>');
const bs=new BetterStripe(componentsGeneric().betterStripe as any,{STRIPE_SECRET_KEY:key,stripeApiVersion:'2026-09-30.preview'});
const ctx:any={runQuery:()=>{throw Error('Unexpected component query');},runMutation:()=>{throw Error('Unexpected component mutation');}};
const run='cost-context-'+crypto.randomUUID();const report:any={sandbox:true,realProvider:true,publicClient:true,apiVersion:'2026-09-30.preview',noPackageMoneyMovement:true};let refundPi:string|undefined;const disputeIds:string[]=[];
async function charge(amount:number,method:string,kind:string){return sdk.paymentIntents.create({amount,currency:'usd',payment_method:method,confirm:true,automatic_payment_methods:{enabled:true,allow_redirects:'never'},description:'BetterStripe processing cost QA '+kind,metadata:{qaRun:run}},{idempotencyKey:run+':'+kind});}
async function context(id:string){for(let i=0;i<40;i++){const value=await bs.getProcessingCostContext(ctx,{paymentIntentId:id});if(value.status==='ready')return value;await delay(1500);}throw Error('Provider cost context unavailable');}
async function disputeFor(id:string){for(let i=0;i<40;i++){const d=(await sdk.disputes.list({payment_intent:id,limit:10})).data[0];if(d)return d;await delay(1500);}throw Error('Test dispute unavailable');}
try{
 const pi=await charge(10000,'pm_card_bypassPending','refund-pagination');refundPi=pi.id;
 for(let i=0;i<101;i++)await sdk.refunds.create({payment_intent:pi.id,amount:1},{idempotencyKey:run+':refund:'+i});
 const costs=await context(pi.id);assert.equal(costs.refunds.length,101);assert.equal(costs.refundedPrincipal,101);assert.equal(costs.transactions.filter(tx=>tx.sourceType==='refund').length,101);
 const rawPayment=await sdk.paymentIntents.retrieve(pi.id,{expand:['latest_charge.balance_transaction']});const ch:any=rawPayment.latest_charge;
 assert.equal(costs.processingFee,ch.balance_transaction.fee);assert.equal(costs.netFees,costs.transactions.reduce((sum,tx)=>sum+tx.fee,0));assert(costs.transactions.every(tx=>Number.isSafeInteger(tx.created)&&tx.currency==='usd'));
 report.refunds={providerCount:101,returnedCount:costs.refunds.length,refundedMinorUnits:costs.refundedPrincipal,originalFeeMinorUnits:costs.processingFee,netFeeMinorUnits:costs.netFees,providerTotalsMatch:true,millisecondDates:true};console.log('Refund pagination passed');
 for(const outcome of ['won','lost'] as const){
  const p=await charge(1000,'pm_card_createDispute','dispute-'+outcome);const d=await disputeFor(p.id);disputeIds.push(d.id);
  const before=await context(p.id);assert(before.disputedPrincipal>0);assert(before.disputes.some(x=>x.id===d.id));
  await sdk.disputes.update(d.id,{evidence:{uncategorized_text:outcome==='won'?'winning_evidence':'losing_evidence'},submit:true},{idempotencyKey:run+':evidence:'+outcome});
  let after:any;for(let i=0;i<40;i++){after=await context(p.id);if(after.disputes.find((x:any)=>x.id===d.id)?.status===outcome)break;await delay(1500);}
  assert.equal(after.disputes.find((x:any)=>x.id===d.id)?.status,outcome);assert.equal(after.disputedPrincipal,outcome==='won'?0:1000);
  assert.equal(after.netFees,after.transactions.reduce((sum:number,tx:any)=>sum+tx.fee,0));
  report[outcome]={principalMinorUnits:after.disputedPrincipal,disputeFeeAdjustment:after.disputeFeeAdjustment,netFeeMinorUnits:after.netFees,providerTransactionsMatch:true};console.log(outcome+' dispute passed');
 }
 report.status='passed';
}catch(error:any){report.status='failed';report.error={message:error.message,code:error.code};process.exitCode=1;}
finally{
 if(refundPi){const p=await sdk.paymentIntents.retrieve(refundPi,{expand:['latest_charge']});const ch:any=p.latest_charge;if(ch.amount_refunded<ch.amount)await sdk.refunds.create({payment_intent:refundPi},{idempotencyKey:run+':cleanup-refund'});}
 report.remainingSuccessfulChargeRefunded=Boolean(refundPi);report.disputeEvidenceFinalized=disputeIds.length;writeFileSync('/tmp/processing-cost-context-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
